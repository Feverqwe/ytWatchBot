/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:chat');
var commands = require('./commands');
var base = require('./base');
var Router = require('./router');
var CustomError = require('./customError').CustomError;
var querystring = require('querystring');

var Chat = function(options) {
    var _this = this;
    var bot = options.bot;
    this.gOptions = options;
    this.stateList = {};

    var language = options.language;
    var serviceToTitle = options.serviceToTitle;
    var users = options.users;
    var router = new Router(bot);

    router.text(/\/ping/, function (req) {
        var chatId = req.getChatId();
        bot.sendMessage(chatId, "pong").catch(function (err) {
            debug('Command ping error!', err);
        });
    });

    router.all(/\/(start|menu|help)/, function (req) {
        var chatId = req.getChatId();

        if (req.message) {
            var help = language.help;
            if (req.params[0] === 'help') {
                if (base.getRandomInt(0, 100) < 30) {
                    help += language.rateMe;
                }
            }
            bot.sendMessage(chatId, help, {
                disable_web_page_preview: true,
                reply_markup: JSON.stringify({
                    inline_keyboard: menuBtnList(0)
                })
            }).catch(function (err) {
                debug('Command start error!', err);
            });
        } else
        if (req.callback_query) {
            var messageId = req.getMessageId();
            var query = req.getQuery();
            bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: menuBtnList(query.page)
            }), {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                debug('CallbackQuery start error!', err);
            });
        }
    });

    router.all(/\/top/, function (req) {
        var chatId = req.getChatId();

        return users.getAllChatChannels().then(function (items) {
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
                    return base.getChannelTitle(options, service.name, channel.id).then(function (title) {
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

            textArr.push(language.users.replace('{count}', info.users.length));
            textArr.push(language.channels.replace('{count}', info.channels.length));

            info.services.forEach(function (service) {
                textArr.push('');
                textArr.push(serviceToTitle[service.name] + ':');
                service.channels.forEach(function (channel, index) {
                    textArr.push((index + 1) + '. ' + channel.title);
                });
            });

            return bot.sendMessage(chatId, textArr.join('\n'), {
                disable_web_page_preview: true
            });
        }).catch(function (err) {
            debug('Command top error!', err);
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

        message += language.rateMe;

        return bot.sendMessage(chatId, message).catch(function (err) {
            debug('Command about error!', err);
        });
    });

    router.all(function (req, next) {
        var chatId = req.getChatId();
        Promise.all([
            users.getChat(chatId).then(function (chat) {
                req.chat = chat;
            }),
            users.getChannels(chatId).then(function (channels) {
                req.channels = channels;
            })
        ]).then(next);
    });

    router.all(/\/add(?:\s+(.+$))?/, function (req) {
        var chatId = req.getChatId();
        var channel = req.params[0];

        var onResponse = function (channel, messageId) {
            addChannel(req, channel).then(function (result) {
                if (messageId) {
                    return bot.editMessageText(result, {
                        chat_id: chatId,
                        message_id: messageId,
                        disable_web_page_preview: true,
                        parse_mode: 'HTML'
                    });
                } else {
                    return bot.sendMessage(chatId, result, {
                        disable_web_page_preview: true,
                        parse_mode: 'HTML'
                    });
                }
            }).catch(function (err) {
                debug('addChannel error!', err);
            });
        };

        if (channel) {
            onResponse(channel);
            return;
        }

        var options = {};
        var msgText = language.enterChannelName;
        if (chatId < 0) {
            msgText += language.groupNote;
            options.reply_markup = JSON.stringify({
                force_reply: true
            });
        }

        _this.gOptions.bot.sendMessage(chatId, msgText, options).then(function (msg) {
            return router.waitResponse({
                event: 'message',
                type: 'text',
                chatId: chatId,
                fromId: req.getFromId()
            }, 3 * 60).then(function (req) {
                onResponse(req.message.text, msg.message_id);
            }).catch(function (err) {
                if (err.message !== 'ETIMEDOUT') {
                    throw err;
                }

                var cancelText = language.commandCanceled.replace('{command}', 'add');
                return bot.editMessageText(cancelText, {
                    chat_id: chatId,
                    message_id: msg.message_id
                });
            })
        }).catch(function (err) {
            debug('Command add error!', err);
        });
    });

    router.all(function (req, next) {
        var chatId = req.getChatId();
        if (!req.chat) {
            bot.sendMessage(chatId, language.emptyServiceList);
        } else {
            next();
        }
    });

    router.all(function (req, next) {
        var chatId = req.getChatId();
        if (!req.channels.length) {
            bot.sendMessage(chatId, language.emptyServiceList);
        } else {
            next();
        }
    });

    router.all(/\/delete/, function (req) {
        var chatId = req.getChatId();
        var query = req.getQuery();
        var messageId = req.getMessageId();

        if (query.cancel) {
            var cancelText = language.commandCanceled.replace('{command}', 'delete');
            bot.editMessageText(cancelText, {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                debug('Command delete error!', err);
            });
            return;
        }

        if (query.channelId) {
            deleteChannel(req, query.channelId).then(function (result) {
                if (req.callback_query) {
                    return bot.editMessageText(result, {
                        chat_id: chatId,
                        message_id: messageId
                    });
                } else {
                    return bot.sendMessage(chatId, result);
                }
            }).catch(function (err) {
                debug('deleteChannel error!', err);
            });
            return;
        }

        var page = query.page || 0;
        var mediumBtn = {
            text: 'Cancel',
            callback_data: '/delete?cancel=true'
        };

        return getDeleteChannelList(_this, req, page, mediumBtn).then(function (btnList) {
            if (req.callback_query && !query.rel) {
                return bot.editMessageReplyMarkup(JSON.stringify({
                    inline_keyboard: btnList
                }), {
                    chat_id: chatId,
                    message_id: messageId
                });
            } else {
                return bot.sendMessage(chatId, language.selectDelChannel, {
                    reply_markup: JSON.stringify({
                        inline_keyboard: btnList
                    })
                });
            }
        }).catch(function (err) {
            debug('Command delete error!', err);
        });
    });

    router.all(/\/options/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        var promise = Promise.resolve();
        if (query.key) {
            promise = promise.then(function () {
                return setOption(req.chat, query.key, query.value);
            });
        }

        promise.then(function () {
            if (req.callback_query && !query.rel) {
                return bot.editMessageReplyMarkup(JSON.stringify({
                    inline_keyboard: optionsBtnList(req.chat)
                }), {
                    chat_id: chatId,
                    message_id: messageId
                });
            } else {
                return bot.sendMessage(chatId, 'Options:', {
                    reply_markup: JSON.stringify({
                        inline_keyboard: optionsBtnList(req.chat)
                    })
                });
            }
        }).catch(function (err) {
            debug('Command options error!', err);
        });
    });

    router.all(/\/setChannel/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        var updateOptionsMessage = function () {
            return req.callback_query && bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: optionsBtnList(req.chat)
            }), {
                chat_id: chatId,
                message_id: messageId
            });
        };

        if (query.remove) {
            delete req.chat.channelId;
            return _this.gOptions.users.setChat(req.chat).then(function () {
                return updateOptionsMessage();
            }).catch(function (err) {
                debug('Command setChannel error!', err);
            });
        }

        var options = {};
        var msgText = language.telegramChannelEnter;
        if (chatId < 0) {
            msgText += language.groupNote;
            options.reply_markup = JSON.stringify({
                force_reply: true
            });
        }

        return bot.sendMessage(chatId, msgText, options).then(function (msg) {
            return router.waitResponse({
                event: 'message',
                type: 'text',
                chatId: chatId,
                fromId: req.getFromId()
            }, 3 * 60).then(function (_req) {
                return setChannel(req, _req.message.text).then(function (result) {
                    return bot.editMessageText(result, {
                        chat_id: chatId,
                        message_id: msg.message_id
                    }).then(function () {
                        return updateOptionsMessage();
                    });
                }).catch(function (err) {
                    debug('setChannel error', err);
                });
            }).catch(function (err) {
                if (err.message !== 'ETIMEDOUT') {
                    throw err;
                }

                var cancelText = language.commandCanceled.replace('{command}', 'setChannel');
                return bot.editMessageText(cancelText, {
                    chat_id: chatId,
                    message_id: msg.message_id
                });
            });
        });
    });

    var setChannel = function (req, channelId) {
        var chat = req.chat;
        return Promise.resolve().then(function () {
            channelId = channelId.trim();

            if (!/^@\w+$/.test(channelId)) {
                throw new Error('BAD_FORMAT');
            }

            return users.getChatByChannelId(channelId).then(function (channelChat) {
                if (channelChat) {
                    throw new Error('CHANNEL_EXISTS');
                }

                return bot.sendChatAction(channelId, 'typing').then(function () {
                    chat.options.mute = false;
                    chat.channelId = channelId;
                });
            }).then(function () {
                return _this.gOptions.users.setChat(chat);
            }).then(function () {
                return language.telegramChannelSet.replace('{channelName}', channelId);
            });
        }).catch(function (err) {
            var msgText = language.telegramChannelError.replace('{channelName}', channelId);
            if (err.message === 'BAD_FORMAT') {
                msgText += ' Channel name is incorrect.';
            } else
            if (err.message === 'CHANNEL_EXISTS') {
                msgText += ' The channel has already been added.';
            } else
            if (/bot is not a member of the (?:channel|supergroup) chat/.test(err.message)) {
                msgText += ' Bot must be admin in this channel.';
            } else
            if (/chat not found/.test(err.message)) {
                msgText += ' Telegram chat is not found!';
            } else {
                debug('setChannel %s error!', channelId, err);
            }
            return msgText;
        });
    };

    var setOption = function (chat, key, value) {
        ['hidePreview', 'mute'].forEach(function (option) {
            if (option === 'hidePreview') {
                chat.options[option] = value === 'true';
                if (!chat.options[option]) {
                    delete chat.options[option];
                }
            }
        });

        if (key === 'channelId' && value === 'null') {
            delete chat.channelId;
        }

        return _this.gOptions.users.setChat(chat);
    };

    var deleteChannel = function (req, channelId) {
        var found = req.channels.some(function (item) {
            return item.service === 'youtube' && item.channelId === channelId;
        });

        if (!found) {
            return language.channelDontExist;
        }

        return _this.gOptions.users.removeChannel(req.chat.id, 'youtube', channelId).then(function () {
            return _this.gOptions.users.getChannels(req.chat.id).then(function (channels) {
                if (channels.length === 0) {
                    return _this.gOptions.users.removeChat(req.chat.id);
                }
            });
        }).then(function () {
            return _this.gOptions.language.channelDeleted.replace('{channelName}', channelId);
        });
    };

    /**
     * @param {Object} _this
     * @param {Req} req
     * @param {number} page
     * @param {Object|Array} mediumBtn
     * @returns {Promise}
     */
    var getDeleteChannelList = function (_this, req, page, mediumBtn) {
        var chatId = req.chat.id;
        return _this.gOptions.users.getChannels(chatId).then(function (channels) {
            var btnList = [];
            var promise = Promise.resolve();
            channels.forEach(function(item) {
                promise = promise.then(function () {
                    return base.getChannelLocalTitle(_this.gOptions, item.service, item.channelId).then(function (title) {
                        var btnItem = {};

                        btnItem.text = title;

                        btnItem.callback_data = '/delete?' + querystring.stringify({
                            channelId: item.channelId,
                            service: item.service
                        });

                        btnList.push([btnItem]);
                    });
                });
            });
            return promise.then(function () {
                return btnList;
            });
        }).then(function (btnList) {
            return base.pageBtnList(btnList, '/delete', page, mediumBtn);
        });
    };

    var addChannel = function (req, channelName) {
        var chatId = req.getChatId();
        return _this.gOptions.services.youtube.getChannelId(channelName).then(function (channel) {
            var channelId = channel.id;
            var title = channel.localTitle;

            var found = req.channels.some(function (item) {
                return item.service === 'youtube' && item.channelId === channelId;
            });

            if (found) {
                return language.channelExists;
            }

            var promise = Promise.resolve();
            if (!req.chat) {
                promise = promise.then(function () {
                    return _this.gOptions.users.setChat({id: chatId});
                });
            }
            return promise.then(function () {
                return _this.gOptions.users.addChannel(chatId, 'youtube', channelId);
            }).then(function () {
                var url = base.getChannelUrl('youtube', channelId);
                var displayName = base.htmlSanitize('a', title, url);

                _this.gOptions.events.emit('subscribe', channelId);

                return _this.gOptions.language.channelAdded
                    .replace('{channelName}', displayName)
                    .replace('{serviceName}', base.htmlSanitize(_this.gOptions.serviceToTitle.youtube));
            });
        }).catch(function(err) {
            if (!err instanceof CustomError) {
                debug('addChannel %s is not found!', channelName, err);
            }

            return language.channelIsNotFound.replace('{channelName}', channelName);
        });
    };

    var menuBtnList = function (page) {
        var btnList = null;
        if (page > 0) {
            btnList = [
                [
                    {
                        text: 'Options',
                        callback_data: '/options?rel=menu'
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
                        callback_data: '/delete?rel=menu'
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

    var optionsBtnList = function (chat) {
        var options = chat.options;

        var btnList = [];

        if (options.hidePreview) {
            btnList.push([{
                text: 'Show preview',
                callback_data: '/options?' + querystring.stringify({
                    key: 'hidePreview',
                    value: false
                })
            }]);
        } else {
            btnList.push([{
                text: 'Hide preview',
                callback_data: '/options?' + querystring.stringify({
                    key: 'hidePreview',
                    value: true
                })
            }]);
        }

        if (chat.channelId) {
            btnList.push([{
                text: 'Remove channel (' + chat.channelId + ')',
                callback_data: '/setChannel?' +  querystring.stringify({
                    remove: true
                })
            }]);
        } else {
            btnList.push([{
                text: 'Set channel',
                callback_data: '/setChannel'
            }]);
        }

        if (chat.channelId) {
            if (options.mute) {
                btnList.push([{
                    text: 'Unmute',
                    callback_data: '/options?' + querystring.stringify({
                        key: 'mute',
                        value: false
                    })
                }]);
            } else {
                btnList.push([{
                    text: 'Mute',
                    callback_data: '/options?' + querystring.stringify({
                        key: 'mute',
                        value: true
                    })
                }]);
            }
        }

        return btnList;
    };
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


module.exports = Chat;