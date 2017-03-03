/**
 * Created by anton on 02.03.17.
 */
const debug = require('debug')('app:router');
const querystring = require('querystring');

const messageTypes = [
    'text', 'audio', 'document', 'photo', 'sticker', 'video', 'voice', 'contact',
    'location', 'new_chat_participant', 'left_chat_participant', 'new_chat_title',
    'new_chat_photo', 'delete_chat_photo', 'group_chat_created'
];

var Router = function (bot) {
    this.stack = [];
    bot.on('message', this.handle.bind(this, 'message'));
    bot.on('callback_query', this.handle.bind(this, 'callback_query'));
};

var getMessage = function (req) {
    var message = null;
    if (req.event === 'message') {
        message = req.message;
    } else
    if (req.event === 'callback_query') {
        message = req.callback_query.message;
    }
    return message;
};

var getChatId = function () {
    return getMessage(this).chat.id;
};

var getMessageId = function () {
    return getMessage(this).message_id;
};

var getQuery = function (callback_query) {
    var text = callback_query.data;
    var re = /\?([^\s]+)/;
    var query = {};
    var m = re.exec(text);
    if (m) {
        query = querystring.parse(m[1]);
    }
    return query;
};

/**
 * @param {string} event
 * @param {Object} message
 * @return {Object}
 */
Router.prototype.getRequest = function (event, message) {
    var obj = {};
    obj.getChatId = getChatId;
    obj.getMessageId = getMessageId;
    if (event === 'callback_query') {
        obj.query = getQuery(message);
    }
    obj.event = event;
    obj[event] = message;
    return obj;
};

/**
 * @param {string} event
 * @param {Object} message
 */
Router.prototype.handle = function (event, message) {
    var _this = this;
    var index = 0;
    var req = _this.getRequest(event, message);
    var next = function () {
        var route = _this.stack[index++];
        if (!route) return;

        req.params = route.match(event, message);
        if (req.params) {
            if (!route.event) {
                return route.dispatch(req, next);
            } else if (route.event === event) {
                if (!route.type) {
                    return route.dispatch(req, next);
                } else if (message[route.type]) {
                    return route.dispatch(req, next);
                }
            }
        }

        next();
    };
    next();
};

/**
 * @param {{}} details
 * @param {string} details.event
 * @param {string} details.type
 * @param {RegExp} re
 * @param {function(Object, function())} callback
 * @constructor
 */
var Route = function (details, re, callback) {
    this.re = re;
    this.event = details.event;
    this.type = details.type;
    this.dispatch = function (req, next) {
        try {
            callback(req, next);
        } catch (err) {
            debug('Dispatch error', err);
        }
    };
};

/**
 * @param {Object} message
 * @return {[]|null}
 */
Route.prototype.match = function (event, message) {
    if (!this.re) {
        return [];
    }

    var text = null;
    if (event === 'message') {
        text = message.text;
    } else
    if (event === 'callback_query') {
        text = message.data;
    }

    if (!text) {
        debug('Text is empty!');
    }

    var params = this.re.exec(text);
    if (params) {
        params = params.shift();
    }
    return params;
};

/**
 * @param {[]} args
 * @return {{re: RegExp, callbackList: [function]}}
 */
Router.prototype.prepareArgs = function (args) {
    var re = args[0];
    var callbackList = [].slice.call(args, 1);
    if (typeof re === 'function') {
        callbackList.unshift(re);
        re = null;
    }
    return {
        re: re,
        callbackList: callbackList
    }
};

/**
 * @param {RegExp} [re]
 * @param {function} callback
 */
Router.prototype.all = function (re, callback) {
    var _this = this;
    var args = _this.prepareArgs(arguments);

    args.callbackList.forEach(function (callback) {
        _this.stack.push(new Route({}, args.re, callback));
    });
};

/**
 * @param {RegExp} [re]
 * @param {function} callback
 */
Router.prototype.message = function (re, callback) {
    var _this = this;
    var args = _this.prepareArgs(arguments);

    args.callbackList.forEach(function (callback) {
        _this.stack.push(new Route({
            event: 'message'
        }, args.re, callback));
    });
};

messageTypes.forEach(function (type) {
    /**
     * @param {RegExp} [re]
     * @param {function} callback
     */
    Router.prototype[type] = function (re, callback) {
        var _this = this;
        var args = _this.prepareArgs(arguments);

        args.callbackList.forEach(function (callback) {
            _this.stack.push(new Route({
                event: 'message',
                type: type
            }, args.re, callback));
        });
    };
});

/**
 * @param {RegExp} [re]
 * @param {function} callback
 */
Router.prototype.callback_query = function (re, callback) {
    var _this = this;
    var args = _this.prepareArgs(arguments);

    args.callbackList.forEach(function (callback) {
        _this.stack.push(new Route({
            event: 'callback_query'
        }, args.re, callback));
    });
};

module.exports = Router;