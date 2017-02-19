/**
 * Created by anton on 31.01.16.
 */
"use strict";
var debug = require('debug')('app:tracker');
var request = require('request');
var Uuid = require('uuid');
var requestPromise = require('request-promise');

var Tracker = function(options) {
    this.gOptions = options;
    this.cache = {};

    this.tid = options.config.gaId;
};

Tracker.prototype.getUuid = function(id) {

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
        prefix = 1;
        vId *= -1;
    }

    var idArr = vId.toString().split('').reverse().join('').match(/(\d{0,2})/g).reverse();

    var index = arr.length;
    var chank;
    while (chank = idArr.pop()) {
        index--;
        arr[index] = parseInt(prefix + chank, 10);
    }

    cid = Uuid.v4({
        random: arr
    });

    this.cache[id] = cid;

    return cid;
};

Tracker.prototype.track = function(msg, action) {
    return Promise.all([
        this.trackerSend(msg, action)/*,
        this.botan.track(msg, action)*/
    ]).catch(function(err) {
        debug('Send error!', err);
    });
};

Tracker.prototype.trackerSend = function(msg, action) {
    var id = msg.chat.id;

    var params = this.sendEvent('bot', action, msg.text);
    params.cid = this.getUuid(id);

    return this.send(params);
};

Tracker.prototype.sendEvent = function(category, action, label) {
    var params = {
        ec: category,
        ea: action,
        el: label,
        t: 'event'
    };

    return params;
};

Tracker.prototype.send = function(params) {
    if (!this.tid) {
        debug('Send in ga %j', params);
        return;
    }

    var defaultParams = {
        v: 1,
        tid: this.tid,
        an: 'bot'
    };

    for (var key in defaultParams) {
        if(!params.hasOwnProperty(key)) {
            params[key] = defaultParams[key];
        }
    }

    return requestPromise({
        url: 'https://www.google-analytics.com/collect',
        method: 'POST',
        form: params,
        gzip: true,
        forever: true
    }).catch(function (err) {
        debug('track error', err);
    });
};

module.exports = Tracker;