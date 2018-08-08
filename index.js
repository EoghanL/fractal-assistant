/**
 * A Bot for Slack!
 */

const ENV = require('dotenv').config({path: __dirname + '/.env'}).parsed

/**
 * Define a function for initiating a conversation on installation
 * With custom integrations, we don't have a way to find out who installed us, so we can't message them :(
 */

function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({user: installer}, function (err, convo) {
            if (err) {
                console.log(err);
            } else {
                convo.say('I am a bot that has just joined your team');
                convo.say('You must now /invite me to a channel so that I can be of use!');
            }
        });
    }
}

/**
 * Configure the persistence options
 */
var config = {};
if (ENV.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({mongoUri: ENV.MONGOLAB_URI, tables: ['topics', 'votes']}),
    };
} else {
    config = {
        json_file_store: ((ENV.TOKEN)?'./db_slack_bot_ci/':'./db_slack_bot_a/'), //use a different name if an app or CI
    };
}

/**
 * Are being run as an app or a custom integration? The initialization will differ, depending
 */

if (ENV.TOKEN || ENV.SLACK_TOKEN) {
    //Treat this as a custom integration
    var customIntegration = require('./lib/custom_integrations');
    var token = (ENV.TOKEN) ? ENV.TOKEN : ENV.SLACK_TOKEN;
    var controller = customIntegration.configure(token, config, onInstallation);

} else if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    var controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
} else {
    console.log('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}

/**
 * A demonstration for how to handle websocket events. In this case, just log when we have and have not
 * been disconnected from the websocket. In the future, it would be super awesome to be able to specify
 * a reconnect policy, and do reconnections automatically. In the meantime, we aren't going to attempt reconnects,
 * WHICH IS A B0RKED WAY TO HANDLE BEING DISCONNECTED. So we need to fix this.
 *
 * TODO: fixed b0rked reconnect behavior
 */
// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});

function showTopics(bot, message, initString='', saveMsgCallback=false) {
  let responseString = initString

  controller.storage.topics.all().then(function (topics) {
    for (var i = 0; i < topics.length; i++) {
      responseString += `${i}.) ${topics[i].name}\n`
    }
    if (responseString.length > initString.length) {
      bot.reply(message, `${responseString}`, function (err, resp) {
        if (err) {
          console.log(err)
        } else {
          if (saveMsgCallback) {
            let topicID = message.client_msg_id.replace(/-/g, "").slice(0, 24)
            controller.storage.votes.save({id: topicID, message: resp}).then(function(correct) {
              return
            }).catch(function(err) {
                console.log(err)
            })
          }
        }
      })
    } else {
      bot.reply(message, 'Looks like there are no topics at the moment!')
    }
  }).catch(function (error) {
      console.log(error)
  })
}

async function getVotingTotals(bot, message, callback) {
  controller.storage.votes.all(function(err, votes) {
    if (err) {
      console.log(`Error: ${err}`)
    } else {
      tallyMsg = votes[votes.length - 1].message

      bot.api.reactions.get({token: token, channel: tallyMsg.channel, timestamp: tallyMsg.ts}, function (err, resp) {
        if (err) {
          console.log('hit')
        } else {
          const { reactions } = resp.message
          const voteTotals = {}

          reactions.forEach(reaction => voteTotals[reaction['name']] = reaction['count'])
          callback(voteTotals)
        }
      })
    }
  })
}

function formatVoteResults(votesObj) {
  return Object.keys(votesObj).reduce((output, voteIdx) => {
    return output += `${voteIdx}: ${votesObj[voteIdx]}\n`
  }, 'The voting results are: \n')
}

function clearLessonTopics(bot, message, response) {
  controller.storage.topics.all().then(function (topics, error) {
    if (error) {
      console.log(error)
    } else {
      for (var i = 0; i < topics.length; i++) {
        controller.storage.topics.delete(topics[i], function(err, topic) {
          console.log(`Deleted: ${topic}`)
        })
      }
      bot.api.reactions.add({
        timestamp: response.ts,
        channel: response.channel,
        name: 'put_litter_in_its_place'
      }, function (err) {
          if (err) {
            console.log(err)
          }
          bot.reply(response, `Topics list cleared!`)
      })
    }
  })
}
/**
 * Core bot logic goes here!
 */
// BEGIN EDITING HERE!

controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, "I'm here!")
});

controller.hears(['NULL', 'Null', 'null', "'null'", '"null"', 'drop table'], [['direct_mention', 'mention', 'direct_message']], function(bot, message) {
    bot.reply(message, "I won't fall for that one.")
})


controller.hears(['add topic', 'Add topic', 'Add Topic'], ['direct_mention', 'mention', 'direct_message'], function(bot, message) {
  const topic = message.text.split('opic ')[1].trim()
  if (topic.length) {
    bot.startConversation(message, function (err, convo) {
      if (err) {
        console.log(err)
        convo.stop()
      } else {
        convo.addQuestion(`Would you like to add ${topic} to the list of learning options?(Y/N)`, (response, convo) => {
          if (['Y', 'YES'].includes(response.text.toUpperCase())) {
            let topicID = response.client_msg_id.replace(/-/g, "").slice(0, 24)
            controller.storage.topics.save({id: topicID, name: topic}).then(function(correct) {
              bot.api.reactions.add({
                timestamp: response.ts,
                channel: response.channel,
                name: 'heavy_check_mark'
              }, function (err) {
                  if (err) {
                    console.log(err)
                  }
                  bot.reply(response, `Thank you for the submission of your topic - ${topic}!`)
                  convo.stop()
              })
            }).catch(function(error) {
                console.log(error);
            });
          } else {
            convo.stop()
          }
        })
      }
    })
  } else {
    bot.reply(message, 'It looks like you forgot to add a topic!')
  }
})

controller.hears(['Get Topics', 'get topics', 'Get topics'], ['direct_mention', 'mention', 'direct_message'], (bot, message) => showTopics(bot, message, 'The current topics are:\n '))

controller.hears(['Start Voting', 'start voting', 'Start voting'], ['direct_mention', 'mention', 'direct_message'], (bot, message) => {
  showTopics(bot, message, 'React with the number emoji that corresponds to the topic you want to learn about!\n', true)
})

controller.hears(['Close voting', 'Close Voting', 'close voting'], ['direct_mention', 'mention', 'direct_message'], function(bot, message) {
  const totals = getVotingTotals(bot, message, function(totalVotes) {
    const voteResults = formatVoteResults(totalVotes)
    console.log(message, totalVotes, voteResults)
    bot.reply(message, voteResults)
  })
})

controller.hears('Hello, there.', 'direct_message', function (bot, message) {
  bot.reply(message, 'https://lh3.googleusercontent.com/-xv1hKxae6hE/WJvjnHjKuEI/AAAAAAAABvE/kZTbR_iH9iEewYpFeWfd2UpeEGB6tS-RACJoC/w500-h150/general.gif')
})

controller.hears(['hello', 'hi', 'greetings '], ['direct_mention', 'mention', 'direct_message'], function(bot,message) {
  bot.reply(message, 'Hello!');
});

controller.hears(['clear topics', 'Clear Topics', 'Clear topics'], ['direct_mention', 'mention', 'direct_message'], function (bot, message) {
  bot.startConversation(message, function(err, convo) {
    if (err) {
      console.log(`Error: ${err}`)
    } else {
      convo.addQuestion('Are you sure you want to clear the current list of topics?(Y/N)', (response, convo) => {
        if (['Y', 'YES'].includes(response.text.toUpperCase())) {
            clearLessonTopics(bot, message, response)
            convo.stop()
        } else {
          convo.stop()
        }
      })
    }
  })
})

/**
 * AN example of what could be:
 * Any un-handled direct mention gets a reaction and a pat response!
 */
controller.on('direct_message,mention,direct_mention', function (bot, message) {
   bot.api.reactions.add({
       timestamp: message.ts,
       channel: message.channel,
       name: 'robot_face',
   }, function (err) {
       if (err) {
           console.log(err)
       }
       bot.reply(message, "I don't know that command, type 'help' to see a list of available ones!");
   });
});
