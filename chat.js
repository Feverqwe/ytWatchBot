/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:chat');
var commands = require('./commands');
var base = require('./base');

var Chat = function(options) {
    var _this = this;
    this.gOptions = options;

    this.stateList = {};

    this.bindBot();

    this.onMessage = (function (orig) {
        return function () {
            var args = arguments;
            return Promise.resolve().then(function() {
                return orig.apply(_this, args);
            });
        };
    })(this.onMessage);

    options.events.on('tickTack', function() {
        var bot = options.bot;
        var now = Date.now();
        var nextUpdate = bot._polling.lastUpdate + 60 * 5 * 1000;
        if (nextUpdate < Date.now()) {
            debug('Polling restart! %s < %s', nextUpdate, now);
            bot.initPolling();
        }
    });
};

Chat.prototype.bindBot = function() {
    this.gOptions.bot.on('message', this.onMessage.bind(this));
    this.gOptions.bot.on('callback_query', this.onCallbackQuery.bind(this));
};

Chat.prototype.checkArgs = function(msg, args, isCallbackQuery) {
    var bot = this.gOptions.bot;
    var language = this.gOptions.language;
    var serviceList = this.gOptions.serviceList;

    if (isCallbackQuery) {
        msg = msg.message;
    }

    var chatId = msg.chat.id;

    var channelName = args[0];
    var service = args[1];

    if (!channelName) {
        bot.sendMessage(chatId, language.channelNameIsEmpty);
        return;
    }

    service = service || serviceList[0];
    service = service.toLowerCase();

    if (service !== 'youtube' || (!/^UC/.test(channelName) && !/^(?:https?:)?\/\//.test(channelName))) {
        channelName = channelName.toLowerCase();
    }

    if (serviceList.indexOf(service) === -1) {
        bot.sendMessage(
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
            return _this.gOptions.bot.answerCallbackQuery(callbackQuery.id, '...');
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
        return _this.gOptions.bot.answerCallbackQuery(callbackQuery.id, '...');
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