/**
 * Created by anton on 31.01.16.
 */
var Promise = require('bluebird');
var debug = require('debug')('tracker');
var request = require('request');
var UUID = require('node-uuid');
var requestPromise = Promise.promisify(request);

var Tracker = function(options) {
    "use strict";
    this.gOptions = options;
    this.cache = {};

    if (options.config.botanToken) {
        this.botan = require('botanio')(options.config.botanToken);
    }
};

Tracker.prototype.getUuid = function(id) {
    "use strict";

    var cid = this.cache[id];
    if (cid) {
        return cid;
    }

    var arr = [];
    for (var i = 0; i < 16; i++) {
        arr[i] = 0x0;
    }

    var vId = id;

    var prefix = 0;
    if (vId < 0) {
        prefix= 1;
        vId *= -1;
    }

    var idArr = vId.toString().split('').reverse().join('').match(/(\d{0,2})/g).reverse();

    var index = arr.length;
    var chank;
    while (chank = idArr.pop()) {
        index--;
        arr[index] = parseInt(prefix + chank, 10);
    }

    var cid = UUID.v4({
        random: arr
    });

    this.cache[id] = cid;

    return cid;
};

Tracker.prototype.track = function(msg, action) {
    "use strict";
    var id = msg.chat.id;

    var params =  this.sendEvent('bot', action, msg.text);
    params.cid = this.getUuid(id);

    return Promise.all([
        this.send(params),
        this.botanSend(msg, action)
    ]).catch(function(err) {
        debug('Error!', err);
    });
};

this.botanSend = function(msg, action) {
    "use strict";
    this.botan && this.botan(msg, action);
};

Tracker.prototype.sendEvent = function(category, action, label) {
    "use strict";
    var params = {
        ec: category,
        ea: action,
        el: label,
        t: 'event',
        cid: cid
    };

    return params;
};

Tracker.prototype.send = function(params) {
    "use strict";
    var defaultParams = {
        v: 1,
        tid: this.gOptions.config.gaId,
        an: 'bot'
    };

    if (!defaultParams.tid) {
        return;
    }

    for (var key in defaultParams) {
        if(!params.hasOwnProperty(key)) {
            params[key] = defaultParams[key];
        }
    }

    return requestPromise({
        url: 'https://www.google-analytics.com/collect?z=' + Date.now(),
        type: 'POST',
        form: params
    })
};

module.exports = Tracker;