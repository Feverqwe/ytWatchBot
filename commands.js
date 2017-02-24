/**
 * Created by anton on 06.12.15.
 */
"use strict";
var Promise = require('bluebird');
var debug = require('debug')('app:commands');
var base = require('./base');
var CustomError = require('./customError').CustomError;

var menuBtnList = function (page) {
    var btnList = null;
    if (page === 1) {
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
                    callback_data: '/menu_page 0'
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
                    callback_data: '/menu_page 1'
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
            callback_data: '/option hidePreview 0'
        }]);
    } else {
        btnList.push([{
            text: 'Hide preview',
            callback_data: '/option hidePreview 1'
        }]);
    }

    if (chat.channelId) {
        btnList.push([{
            text: 'Remove channel (' + chat.channelId + ')',
            callback_data: '/setchannel remove'
        }]);
    } else {
        btnList.push([{
            text: 'Set channel',
            callback_data: '/setchannel'
        }]);
    }

    if (chat.channelId) {
        if (options.mute) {
            btnList.push([{
                text: 'Unmute',
                callback_data: '/option mute 0'
            }]);
        } else {
            btnList.push([{
                text: 'Mute',
                callback_data: '/option mute 1'
            }]);
        }
    }

    return btnList;
};

/**
 * @param {Object} _this
 * @param {string} chatId
 * @param {number} page
 * @param {Object|Array} mediumBtn
 * @returns {Promise}
 */
var getDeleteChannelList = function (_this, chatId, page, mediumBtn) {
    var btnList = [];
    var oneServiceMode = _this.gOptions.serviceList.length === 1;

    return _this.gOptions.users.getChannels(chatId).then(function (channels) {
        var promise = Promise.resolve();
        channels.forEach(function(item) {
            promise = promise.then(function () {
                return base.getChannelLocalTitle(_this.gOptions, item.service, item.channelId).then(function (title) {
                    var btnItem = {};

                    if (!oneServiceMode) {
                        title += ' (' + _this.gOptions.serviceToTitle[item.service] + ')';
                    }

                    btnItem.text = title;

                    btnItem.callback_data = '/d "' + item.channelId + '" "' + item.service + '"';

                    btnList.push([btnItem]);
                });
            });
        });
        return promise;
    }).then(function () {
        return base.pageBtnList(btnList, 'delete_upd', page, mediumBtn);
    });
};

var setOption = function (_this, chat, optionName, state) {
    if (['hidePreview', 'mute'].indexOf(optionName) === -1) {
        debug('Option is not found! %s', optionName);
        return Promise.reject(new Error('Option is not found!'));
    }

    var options = chat.options;

    options[optionName] = state === '1';
    if (!options[optionName]) {
        delete options[optionName];
    }

    var msgText = 'Option ' + optionName + ' (' + state + ') changed!';

    return _this.gOptions.users.setChat(chat).then(function () {
        return msgText;
    });
};

var commands = {
    ping: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(chatId, "pong");
    },
    start: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.help, {
            reply_markup: JSON.stringify({
                inline_keyboard: menuBtnList(0)
            })
        });
    },
    menu_page__Cb: function (callbackQuery, page) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        page = parseInt(page);

        return _this.gOptions.bot.editMessageReplyMarkup(
            chatId,
            {
                message_id: msg.message_id,
                reply_markup: JSON.stringify({
                    inline_keyboard: menuBtnList(page)
                })
            }
        );
    },
    help: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        var text = _this.gOptions.language.help;
        if (base.getRandomInt(0, 100) < 30) {
            text += _this.gOptions.language.rateMe;
        }

        return _this.gOptions.bot.sendMessage(chatId, text, {
            disable_web_page_preview: true,
            reply_markup: JSON.stringify({
                inline_keyboard: menuBtnList(0)
            })
        });
    },
    a: function (msg, channelId, service) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.services[service].getChannelId(channelId).then(function (channel) {
            var channelId = channel.id;
            var title = channel.localTitle;

            return _this.gOptions.users.getChannels(chatId).then(function (channels) {
                var found = channels.some(function (item) {
                    return item.service === service && item.channelId === channelId;
                });

                if (found) {
                    return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.channelExists);
                }

                return _this.gOptions.users.getChat(chatId).then(function (chat) {
                    var promise = Promise.resolve();
                    if (!chat) {
                        promise = promise.then(function () {
                            return _this.gOptions.users.setChat({id: chatId});
                        });
                    }
                    promise = promise.then(function () {
                        return _this.gOptions.users.insertChannel(chatId, service, channelId);
                    });
                    return promise;
                }).then(function () {
                    var url = base.getChannelUrl(service, channelId);
                    var displayName = base.htmlSanitize('a', title, url);

                    if (service === 'youtube') {
                        _this.gOptions.events.emit('subscribe', channelId);
                    }

                    return _this.gOptions.bot.sendMessage(
                        chatId,
                        _this.gOptions.language.channelAdded
                            .replace('{channelName}', displayName)
                            .replace('{serviceName}', base.htmlSanitize(_this.gOptions.serviceToTitle[service])),
                        {
                            disable_web_page_preview: true,
                            parse_mode: 'HTML'
                        }
                    );
                });
            });
        }).catch(function(err) {
            if (!err instanceof CustomError) {
                debug('Channel %s (%s) is not found!', channelId, service, err);
            }
            return _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.channelIsNotFound
                    .replace('{channelName}', channelId)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service])
            );
        });
    },
    add: function (msg, channelName, serviceName) {
        var _this = this;
        var chatId = msg.chat.id;

        var data = [];

        var oneServiceMode = _this.gOptions.serviceList.length === 1;
        if (oneServiceMode && channelName) {
            data.push.apply(data, arguments);
            data.shift();
            channelName = data.join(' ');
            serviceName = null;
            data.splice(0);
        }

        var readUrl = function(url) {
            var channelName = null;
            for (var service in _this.gOptions.serviceMatchRe) {
                var reList = _this.gOptions.serviceMatchRe[service];
                if (!Array.isArray(reList)) {
                    reList = [reList];
                }
                reList.some(function(re) {
                    if (re.test(url)) {
                        channelName = url.match(re)[1];
                        return true;
                    }
                });
                if (channelName) {
                    break;
                }
            }
            return channelName && {
                channel: channelName,
                service: service
            };
        };

        if (channelName) {
            var info = readUrl(channelName);
            if (info) {
                data.push('"'+ info.channel + '"');
                data.push('"' + info.service + '"');
            } else {
                data.push('"'+ channelName + '"');
                serviceName && data.push('"' + serviceName + '"');
            }
        }

        var onTimeout = function(onMessage) {
            msg.text = '/cancel add';
            if (onMessage.messageId) {
                msg.text += ' ' + onMessage.messageId;
            }
            return _this.onMessage(msg);
        };

        var waitChannelName = function() {
            var onMessage = _this.stateList[chatId] = function(msg, text) {
                var info = readUrl(text);
                if (info) {
                    data.push('"' + info.channel + '"');
                    data.push('"' + info.service + '"');
                } else {
                    data.push('"' + text + '"');
                }

                msg.text = '/a ' + data.join(' ');
                return _this.onMessage(msg);
            };
            onMessage.command = 'add';
            onMessage.userId = msg.from.id;
            onMessage.timeout = setTimeout(function() {
                return onTimeout(onMessage);
            }, 3 * 60 * 1000);

            var options = null;
            var msgText = _this.gOptions.language.enterChannelName;
            if (chatId < 0) {
                msgText += _this.gOptions.language.groupNote;
                options = {
                    reply_markup: JSON.stringify({
                        force_reply: true
                    })
                };
            }
            
            return _this.gOptions.bot.sendMessage(chatId, msgText, options).then(function (msg) {
                if (chatId > 0) {
                    onMessage.messageId = msg.message_id;
                }
            });
        };

        if (data.length === 0) {
            return waitChannelName();
        } else {
            msg.text = '/a ' + data.join(' ');
            return _this.onMessage(msg);
        }
    },
    d__Cb: function (callbackQuery, channelId, service) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChannels(chatId).then(function (channels) {
            var found = channels.some(function (item) {
                return service === item.service && item.channelId === channelId;
            });

            if (!found) {
                return _this.gOptions.bot.editMessageText(
                    chatId,
                    _this.gOptions.language.channelDontExist,
                    {
                        message_id: msg.message_id
                    }
                );
            }

            return _this.gOptions.users.removeChannel(chatId, service, channelId).then(function () {
                return _this.gOptions.users.getChannels(chatId).then(function (channels) {
                    var promise = Promise.resolve();
                    if (channels.length === 0) {
                        promise = promise.then(function () {
                            _this.gOptions.users.removeChat(chatId);
                        });
                    }
                    promise = promise.then(function () {
                        return _this.gOptions.bot.editMessageText(
                            chatId,
                            _this.gOptions.language.channelDeleted
                                .replace('{channelName}', channelId)
                                .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                            {
                                message_id: msg.message_id
                            }
                        );
                    });
                    return promise;
                });
            });
        });
    },
    delete_upd__Cb: function (callbackQuery, page) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.editMessageText(
                    chatId,
                    _this.gOptions.language.emptyServiceList,
                    {
                        message_id: msg.message_id
                    }
                );
            }

            var mediumBtn = {
                text: 'Cancel',
                callback_data: '/c "delete"'
            };

            return getDeleteChannelList(_this, chatId, page, mediumBtn).then(function (btnList) {
                return _this.gOptions.bot.editMessageReplyMarkup(chatId, {
                    message_id: msg.message_id,
                    reply_markup: JSON.stringify({
                        inline_keyboard: btnList
                    })
                });
            });
        });
    },
    delete: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
            }

            var msgText = _this.gOptions.language.selectDelChannel;

            var mediumBtn = {
                text: 'Cancel',
                callback_data: '/c "delete"'
            };

            return getDeleteChannelList(_this, chatId, 0, mediumBtn).then(function (btnList) {
                return _this.gOptions.bot.sendMessage(chatId, msgText, {
                    reply_markup: JSON.stringify({
                        inline_keyboard: btnList
                    })
                });
            });
        });
    },
    option: function (msg, optionName, state) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
            }

            return setOption(_this, chat, optionName, state).then(function (msgText) {
                return _this.gOptions.bot.sendMessage(chatId, msgText);
            });
        });
    },
    option__Cb: function (callbackQuery, optionName, state) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.editMessageText(
                    chatId,
                    _this.gOptions.language.emptyServiceList,
                    {
                        message_id: msg.message_id
                    }
                );
            }

            return setOption(_this, chat, optionName, state).then(function (msgText) {
                return _this.gOptions.bot.editMessageReplyMarkup(chatId, {
                    message_id: msg.message_id,
                    reply_markup: JSON.stringify({
                        inline_keyboard: optionsBtnList(chat)
                    })
                });
            });
        });
    },
    options: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
            }

            return _this.gOptions.bot.sendMessage(chatId, 'Options:', {
                reply_markup: JSON.stringify({
                    inline_keyboard: optionsBtnList(chat)
                })
            });
        });
    },
    c__Cb: function (callbackQuery, command) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.editMessageText(
            chatId,
            _this.gOptions.language.commandCanceled
                .replace('{command}', command || ''),
            {
                message_id: msg.message_id
            }
        );
    },
    cancel: function (msg, arg1, messageId) {
        var _this = this;
        var chatId = msg.chat.id;
        var promise = null;

        var text = _this.gOptions.language.commandCanceled.replace('{command}', arg1 || '');

        if (messageId) {
            messageId = parseInt(messageId);
            promise = _this.gOptions.bot.editMessageText(
                chatId,
                text,
                {
                    message_id: messageId
                }
            );
        } else {
            promise = _this.gOptions.bot.sendMessage(
                chatId,
                text
            );
        }
        return promise;
    },
    clear: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
            }

            var btnList = [[{
                text: 'Yes',
                callback_data: '/clearyes'
            }, {
                text: 'No',
                callback_data: '/c "clear"'
            }]];

            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.clearSure, {
                reply_markup: JSON.stringify({
                    inline_keyboard: btnList
                })
            });
        });
    },
    clearyes__Cb: function(callbackQuery) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.editMessageText(
                    chatId,
                    _this.gOptions.language.emptyServiceList,
                    {
                        message_id: msg.message_id
                    }
                );
            }

            return _this.gOptions.users.removeChat(chat.id).then(function () {
                return _this.gOptions.bot.editMessageText(
                    chatId,
                    _this.gOptions.language.cleared,
                    {
                        message_id: msg.message_id
                    }
                );
            });
        });
    },
    list: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChannels(chatId).then(function (channels) {
            var services = [];

            var serviceObjMap = {};
            channels.forEach(function (item) {
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
                        id: channelId
                    };
                    service.count++;
                    service.channels.push(channel);
                }
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
            });

            return Promise.all(services.map(function (service) {
                return Promise.all(service.channels.map(function (channel) {
                    return base.getChannelTitle(_this.gOptions, service.name, channel.id).then(function (title) {
                        channel.title = title;
                    })
                }));
            })).then(function () {
                return {
                    services: services
                };
            });
        }).then(function (info) {
            if (!info.services.length) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
            }

            var textArr = [];

            info.services.forEach(function (service) {
                textArr.push(base.htmlSanitize('b', _this.gOptions.serviceToTitle[service.name]) + ':');
                service.channels.forEach(function (channel) {
                    textArr.push(base.htmlSanitize('a', channel.title, base.getChannelUrl(service, channel.id)));
                });
            });

            return _this.gOptions.bot.sendMessage(chatId, textArr.join('\n\n'), {
                disable_web_page_preview: true,
                parse_mode: 'HTML'
            });
        });
    },
    setchannel: function (msg, channelId) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
            }

            var onTimeout = function(onMessage) {
                msg.text = '/cancel setchannel';
                if (onMessage.messageId) {
                    msg.text += ' ' + onMessage.messageId;
                }
                return _this.onMessage(msg);
            };

            var onGetChannelId = function (msg, channelId) {
                channelId = channelId.trim();
                return Promise.resolve().then(function () {
                    var options = chat.options;

                    if (channelId === 'remove') {
                        chat.channelId = null;
                        delete options.mute;
                    } else {
                        if (!/^@\w+$/.test(channelId)) {
                            throw new Error('BAD_FORMAT');
                        }

                        /*if (exists) {
                            throw new Error('CHANNEL_EXISTS');
                        }*/

                        return _this.gOptions.bot.sendChatAction(channelId, 'typing').then(function () {
                            chat.channelId = channelId;
                        });
                    }

                    return _this.gOptions.users.setChat(chat);
                }).catch(function (err) {
                    var msgText = _this.gOptions.language.telegramChannelError;
                    msgText = msgText.replace('{channelName}', channelId);
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
                        debug('Set channel %s error!', channelId, err);
                    }

                    return _this.gOptions.bot.sendMessage(chatId, msgText).then(function () {
                        throw new CustomError('SET_CHANNEL_ERROR');
                    });
                }).then(function () {
                    return _this.gOptions.bot.sendMessage(chatId, 'Options:', {
                        reply_markup: JSON.stringify({
                            inline_keyboard: optionsBtnList(chat)
                        })
                    });
                }).catch(function (err) {
                    if (err.message !== 'SET_CHANNEL_ERROR') {
                        throw err;
                    }
                });
            };

            var waitTelegramChannelId = function() {
                var onMessage = _this.stateList[chatId] = function(msg, text) {
                    msg.text = '/setchannel "' + text + '"';
                    return _this.onMessage(msg);
                };
                onMessage.command = 'setchannel';
                onMessage.userId = msg.from.id;
                onMessage.timeout = setTimeout(function() {
                    return onTimeout(onMessage);
                }, 3 * 60 * 1000);

                var options = null;
                var msgText = _this.gOptions.language.telegramChannelEnter;
                if (chatId < 0) {
                    msgText += _this.gOptions.language.groupNote;
                    options = {
                        reply_markup: JSON.stringify({
                            force_reply: true
                        })
                    };
                }

                return _this.gOptions.bot.sendMessage(chatId, msgText, options).then(function (msg) {
                    if (chatId > 0) {
                        onMessage.messageId = msg.message_id;
                    }
                });
            };

            if (channelId) {
                return onGetChannelId(msg, channelId);
            } else {
                return waitTelegramChannelId();
            }
        });
    },
    top: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.users.getAllChatChannels().then(function (items) {
            var users = [];
            var channels = [];
            var services = [];

            var serviceObjMap = {};
            items.forEach(function (item) {
                var userId = item.userId;
                if (users.indexOf(userId) === -1) {
                    users.push(userId);
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
    },
    about: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        var liveTime = {
            endTime: '2017,05,05',
            message: [
                '{count}'
            ]
        };

        try {
            liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));
        } catch (err) {
            debug('Load liveTime.json error!', err);
        }

        var endTime = liveTime.endTime.split(',');
        endTime = (new Date(endTime[0], endTime[1], endTime[2])).getTime();
        var count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;

        var message = liveTime.message.join('\n').replace('{count}', count);

        message += _this.gOptions.language.rateMe;

        return _this.gOptions.bot.sendMessage(chatId, message);
    },
    refreshChannelInfo: function(msg) {
        var _this = this;
        var chatId = msg.chat.id;

        var services = _this.gOptions.services;
        return _this.gOptions.checker.getChannelList().then(function (serviceChannelList) {
            var queue = Promise.resolve();
            Object.keys(serviceChannelList).forEach(function (serviceName) {
                var service = services[serviceName];

                serviceChannelList[serviceName].forEach(function (id) {
                    queue = queue.then(function () {
                        return service.getChannelId(id).catch(function (err) {
                            debug('refreshChannelInfo %s', id, err);
                        });
                    });
                });
            });
            return queue;
        }).then(function() {
            return _this.gOptions.bot.sendMessage(chatId, 'Done!');
        });
    },
    checkUserAlive: function(msg) {
        var _this = this;
        var chatId = msg.chat.id;

        var queue = Promise.resolve();

        _this.gOptions.users.getAllChatIds().then(function (chatList) {
            chatList.forEach(function (chatId) {
                queue = queue.then(function () {
                    return _this.gOptions.bot.sendChatAction(chatId, 'typing').catch(function (err) {
                        debug('checkUserAlive %s', chatId, err);
                        _this.gOptions.msgSender.onSendMsgError(err, chatId);
                    });
                });
            });
        });

        return queue.then(function() {
            return _this.gOptions.bot.sendMessage(chatId, 'Done!');
        });
    }
};

commands.stop = commands.clear;

module.exports = commands;