/**
 * Created by anton on 02.03.17.
 */
var debug = require('debug')('app:router');

const messageTypes = [
    'text', 'audio', 'document', 'photo', 'sticker', 'video', 'voice', 'contact',
    'location', 'new_chat_participant', 'left_chat_participant', 'new_chat_title',
    'new_chat_photo', 'delete_chat_photo', 'group_chat_created'
];

var Router = function (options) {
    this.gOptions = options;
    this.stack = [];
    options.bot.on('message', this.handle.bind(this, 'message'));
    options.bot.on('callback_query', this.handle.bind(this, 'callback_query'));
};

/**
 * @param {string} event
 * @param {{}} message
 * @return {{event: string, message: {}}}
 */
Router.prototype.getRequest = function (event, message) {
    return {
        event: event,
        message: message
    }
};

/**
 * @param {string} event
 * @param {{}} message
 */
Router.prototype.handle = function (event, message) {
    var _this = this;
    var index = 0;
    var req = _this.getRequest(event, message);
    var next = function () {
        var route = _this.stack[index];
        if (!route) return;

        req.params = route.match(message);
        if (!req.params) {
            return next();
        }

        if (!route.event) {
            route.dispatch(req, next);
        } else
        if (route.event === event) {
            if (!route.type) {
                route.dispatch(req, next);
            } else
            if (message[route.type]) {
                route.dispatch(req, next);
            }
        }
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
 * @param {{}} message
 * @return {[]|null}
 */
Route.prototype.match = function (message) {
    if (!this.re) {
        return [];
    }

    var text = null;
    if (this.event === 'message') {
        text = message.text;
    } else
    if (this.event === 'callback_query') {
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
        }, re, callback));
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
            }, re, callback));
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
        }, re, callback));
    });
};