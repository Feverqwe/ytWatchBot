/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:chat');
var commands = require('./commands');
var base = require('./base');
var Router = require('./router');

var Chat = function(options) {
    var _this = this;
    var bot = options.bot;
    this.gOptions = options;
    this.stateList = {};
    var router = this.router = new Router(_this.gOptions.bot);

    router.text(/\/ping/, function (req) {
        var chatId = req.getChatId();
        _this.gOptions.bot.sendMessage(chatId, "pong");
    });

    router.all(/\/(start|menu|help)/, function (req) {
        var chatId = req.getChatId();

        if (req.event === 'message') {
            var help = _this.gOptions.language.help;
            if (req.params[0] === 'help') {
                if (base.getRandomInt(0, 100) < 30) {
                    help += _this.gOptions.language.rateMe;
                }
            }
            _this.gOptions.bot.sendMessage(chatId, help, {
                disable_web_page_preview: true,
                reply_markup: JSON.stringify({
                    inline_keyboard: menuBtnList(0)
                })
            });
        } else
        if (req.event === 'callback_query') {
            var messageId = req.getMessageId();
            _this.gOptions.bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: menuBtnList(req.query.page)
            }), {
                chat_id: chatId,
                message_id: messageId
            });
        }
    });

    router.all(/\/top/, function (req) {
        var chatId = req.getChatId();

        return _this.gOptions.users.getAllChatChannels().then(function (items) {
            var users = [];
            var channels = [];
            var services = [];

            var serviceObjMap = {};
            items.forEach(function (item) {
                var chatId = item.chatId;
                if (users.indexOf(chatId) === -1) {
                    users.push(chatId);
                }

                var service = serviceObjMap[item.service];
                if (!service) {
                    service = serviceObjMap[item.service] = {
                        name: item.service,
                        count: 0,
                        channels: [],
                        channelObjMap: {}
                    };
                    services.push(service);
                }

                var channelId = item.channelId;
                var channel = service.channelObjMap[channelId];
                if (!channel) {
                    channel = service.channelObjMap[channelId] = {
                        id: channelId,
                        count: 0
                    };
                    service.count++;
                    service.channels.push(channel);
                    channels.push(channel);
                }
                channel.count++;
            });
            serviceObjMap = null;

            var sortFn = function (aa, bb) {
                var a = aa.count;
                var b = bb.count;
                return a === b ? 0 : a > b ? -1 : 1;
            };

            services.sort(sortFn);

            services.forEach(function (service) {
                delete service.channelObjMap;

                service.channels.sort(sortFn).splice(10);
            });

            return Promise.all(services.map(function (service) {
                return Promise.all(service.channels.map(function (channel) {
                    return base.getChannelTitle(_this.gOptions, service.name, channel.id).then(function (title) {
                        channel.title = title;
                    })
                }));
            })).then(function () {
                return {
                    users: users,
                    channels: channels,
                    services: services
                };
            });
        }).then(function (info) {
            var textArr = [];

            textArr.push(_this.gOptions.language.users.replace('{count}', info.users.length));
            textArr.push(_this.gOptions.language.channels.replace('{count}', info.channels.length));

            info.services.forEach(function (service) {
                textArr.push('');
                textArr.push(_this.gOptions.serviceToTitle[service.name] + ':');
                service.channels.forEach(function (channel, index) {
                    textArr.push((index + 1) + '. ' + channel.title);
                });
            });

            return _this.gOptions.bot.sendMessage(chatId, textArr.join('\n'), {
                disable_web_page_preview: true
            });
        });
    });

    router.all(/\/about/, function (req) {
        var chatId = req.getChatId();

        var liveTime = {
            endTime: '1970-01-01',
            message: [
                '{count}'
            ]
        };

        try {
            liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));
        } catch (err) {
            debug('Load liveTime.json error!', err);
        }

        var count = '';
        var endTime = /(\d{4}).(\d{2}).(\d{2})/.exec(liveTime.endTime);
        if (endTime) {
            endTime = (new Date(endTime[1], endTime[2], endTime[3])).getTime();
            count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;
        }

        var message = liveTime.message;
        if (Array.isArray(message)) {
            message = message.join('\n');
        }

        message = message.replace('{count}', count);

        message += _this.gOptions.language.rateMe;

        return _this.gOptions.bot.sendMessage(chatId, message);
    });

    router.all(function (req, next) {
        var chatId = req.getChatId();
        _this.gOptions.users.getChat(chatId).then(function (chat) {
            req.chat = chat;
            next();
        });
    });

    router.all(function (req, next) {
        var chatId = req.getChatId();
        if (!req.chat) {
            _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        } else {
            next();
        }
    });

    router.all(function (req, next) {
        var chatId = req.getChatId();
        _this.gOptions.users.getChannels(chatId).then(function (channels) {
            req.channels = channels;
            next();
        });
    });

    router.all(function (req, next) {
        var chatId = req.getChatId();
        if (!req.channels.length) {
            _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        } else {
            next();
        }
    });
};

Chat.prototype.checkArgs = function(msg, args, isCallbackQuery) {
    var _this = this;
    var language = this.gOptions.language;
    var serviceList = this.gOptions.serviceList;

    if (isCallbackQuery) {
        msg = msg.message;
    }

    var chatId = msg.chat.id;

    var channelName = args[0];
    var service = args[1];

    if (!channelName) {
        _this.gOptions.bot.sendMessage(chatId, language.channelNameIsEmpty);
        return;
    }

    service = service || serviceList[0];
    service = service.toLowerCase();

    if (service !== 'youtube' || (!/^UC/.test(channelName) && !/^(?:https?:)?\/\//.test(channelName))) {
        channelName = channelName.toLowerCase();
    }

    if (serviceList.indexOf(service) === -1) {
        _this.gOptions.bot.sendMessage(
            chatId,
            language.serviceIsNotSupported.replace('{serviceName}', service)
        );
        return;
    }

    args[0] = channelName;
    args[1] = service;

    return args;
};

Chat.prototype.removeBotName = function (text) {
    var botName = this.gOptions.config.botName;
    text = text.replace(/@(\w+bot)/ig, function (str, text) {
        var name = text.toLowerCase();
        if (name === botName) {
            return '';
        } else {
            return '@' + text;
        }
    });
    return text;
};

Chat.prototype.msgParser = function(text) {
    var list = [];
    var templateList = [];

    text = this.removeBotName(text);

    text = text.replace(/%/g, '').replace(/\r\n\t/g, ' ');
    text = text.replace(/"([^"]+)"/g, function(text, value) {
        var index = templateList.push(value.trim());
        return '%'+index+'%'
    });

    text.split(/\s+/).forEach(function(value) {
        if (!value) {
            return;
        }
        var index = value.match(/^%(\d+)%$/);
        if (index) {
            index = parseInt(index[1]) - 1;
            list.push(templateList[index]);
            return;
        }

        list.push(value);
    });

    return list;
};

Chat.prototype.callbackQueryToMsg = function (callbackQuery) {
    var msg = JSON.parse(JSON.stringify(callbackQuery.message));
    msg.from = callbackQuery.from;
    msg.text = callbackQuery.data;
    return msg;
};

Chat.prototype.onCallbackQuery = function (callbackQuery) {
    var _this = this;

    var data = callbackQuery.data;

    if (!data) {
        debug('Callback query data is empty! %j', callbackQuery);
        return;
    }

    if (data[0] !== '/') {
        debug('Callback query data is not command! %s', data);
        return;
    }

    data = data.substr(1);

    var args = this.msgParser(data);

    if (args.length === 0) {
        debug('Callback query args is empty! %s', data);
        return;
    }

    var action = args.shift().toLowerCase();

    if (['list', 'add', 'delete', 'top', 'about', 'clear', 'options', 'setchannel'].indexOf(action) !== -1) {
        return this.onMessage(this.callbackQueryToMsg(callbackQuery)).then(function () {
            return _this.gOptions.bot.answerCallbackQuery(callbackQuery.id);
        });
    }

    var commandFunc = commands[action + '__Cb'];

    if (!commandFunc) {
        debug('Command %s is not found!', action);
        return;
    }

    if (['d'].indexOf(action) !== -1) {
        args = this.checkArgs(callbackQuery, args, true);
        if (!args) {
            return;
        }
    }

    args.unshift(callbackQuery);

    var origMsg = this.callbackQueryToMsg(callbackQuery);

    return commandFunc.apply(this, args).then(function () {
        return _this.gOptions.bot.answerCallbackQuery(callbackQuery.id);
    }).catch(function(err) {
        if (!/message is not modified/.test(err.message)) {
            debug('Execute callback query command %s error!', action, err);
        }
    }).then(function() {
        _this.track(origMsg, action)
    });
};

Chat.prototype.onMessage = function(msg) {
    var _this = this;
    var text = msg.text;
    var chatId = msg.chat.id;

    if (msg.migrate_from_chat_id) {
        return _this.gOptions.users.changeChatId(msg.migrate_from_chat_id, chatId);
    }

    if (msg.migrate_to_chat_id) {
        return _this.gOptions.users.changeChatId(chatId, msg.migrate_to_chat_id);
    }

    if (!text) {
        // debug('Msg without text! %j', msg);
        return;
    }

    var responseFunc = this.stateList[chatId] || null;
    if (responseFunc && msg.from.id !== responseFunc.userId) {
        responseFunc = null;
    }

    if (responseFunc) {
        clearTimeout(responseFunc.timeout);
        delete this.stateList[chatId];
    }

    if (text[0] !== '/') {
        if (responseFunc) {
            text = this.removeBotName(msg.text);
            return responseFunc.call(this, msg, text).catch(function(err) {
                debug('Execute responseFunc %s error!', responseFunc.command, err);
            });
        }

        // debug('Msg is not command! %j', msg);
        return;
    }

    text = text.substr(1);

    var args = this.msgParser(text);

    if (args.length === 0) {
        debug('Msg args is empty! %s', text);
        return;
    }

    var action = args.shift().toLowerCase();
    
    var commandFunc = commands[action];
    if (!commandFunc) {
        debug('Command %s is not found!', action);
        return;
    }

    if (['a', 'd'].indexOf(action) !== -1) {
        args = this.checkArgs(msg, args);
        if (!args) {
            return;
        }
    }

    args.unshift(msg);

    var origMsg = JSON.parse(JSON.stringify(msg));

    return commandFunc.apply(this, args).catch(function(err) {
        debug('Execute command %s error!', action, err);
    }).then(function() {
        _this.track(origMsg, action)
    });
};

Chat.prototype.track = function(msg, title) {
    return this.gOptions.tracker.track({
        text: msg.text,
        from: {
            id: msg.from.id
        },
        chat: {
            id: msg.chat.id
        },
        date: msg.date
    }, title);
};


var menuBtnList = function (page) {
    var btnList = null;
    if (page > 0) {
        btnList = [
            [
                {
                    text: 'Options',
                    callback_data: '/options'
                }
            ],
            [
                {
                    text: '<',
                    callback_data: '/menu?page=0'
                },
                {
                    text: 'Top 10',
                    callback_data: '/top'
                },
                {
                    text: 'About',
                    callback_data: '/about'
                }
            ]
        ];
    } else {
        btnList = [
            [
                {
                    text: 'Show the channel list',
                    callback_data: '/list'
                }
            ],
            [
                {
                    text: 'Add channel',
                    callback_data: '/add'
                },
                {
                    text: 'Delete channel',
                    callback_data: '/delete'
                },
                {
                    text: '>',
                    callback_data: '/menu?page=1'
                }
            ]
        ];
    }

    return btnList;
};

module.exports = Chat;