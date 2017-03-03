/**
 * Created by anton on 02.03.17.
 */

const _messageTypes = [
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

Router.prototype.handle = function (event, message) {
    var _this = this;
    var index = 0;
    var next = function () {
        var route = _this.stack[index];
        var details = route.details;

        if (!details.event) {
            route.dispatch(message, next);
        } else
        if (details.event === event) {
            if (!details.type) {
                route.dispatch(message, next);
            } else
            if (details.type && message[details.type]) {
                route.dispatch(message, next);
            }
        }
    };
    next();
};

var Route = function (details, re, callback) {
    if (typeof re === 'function') {
        callback = re;
        re = null;
    }
    this.re = re;
    this.details = details;
    this.dispatch = function (message, next) {
        callback(message, next);
    };
};

Router.prototype.all = function (re, callback) {
    this.stack.push(new Route({}, re, callback));
};

Router.prototype.message = function (re, callback) {
    this.stack.push(new Route({
        event: 'message'
    }, re, callback));
};

_messageTypes.forEach(function (type) {
    Router.prototype[type] = function (re, callback) {
        this.stack.push(new Route({
            event: 'message',
            type: type
        }, re, callback));
    };
});

Router.prototype.callback_query = function (re, callback) {
    this.stack.push(new Route({
        event: 'callback_query'
    }, re, callback));
};