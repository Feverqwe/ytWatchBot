/**
 * Created by Anton on 18.12.2015.
 */
"use strict";
const debug = require('debug')('app:pubsub');
const pubSubHubbub = require("pubsubhubbub");
const xmldoc = require("xmldoc");

var PushApi = function(options) {
    var _this = this;
    this.gOptions = options;

    this.topic = 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=';
    this.hub = 'https://pubsubhubbub.appspot.com/subscribe';

    this.pubsub = pubSubHubbub.createServer(this.gOptions.config.push);

    this.onReady = new Promise(function(resolve) {
        _this.initListener(resolve);
    });

    _this.gOptions.events.on('subscribe', function(/*dbChannel*/channel) {
        const ytChannelId = _this.gOptions.channels.unWrapId(channel.id);
        _this.subscribe(ytChannelId).then(function () {
            channel.subscribed = 1;
            return _this.gOptions.channels.updateChannel(channel.id, {
                subscribed: channel.subscribed
            });
        }).catch(function (err) {
            debug('Subscribe event error! %s', channel.id, err);
        });
    });

    _this.gOptions.events.on('unsubscribe', function(channelIds) {
        if (!Array.isArray(channelIds)) {
            channelIds = [channelIds];
        }

        var dDblList = [];

        channelIds.forEach(function(channelId) {
            if (dDblList.indexOf(channelId) === -1) {
                dDblList.push(channelId);

                const ytChannelId = _this.gOptions.channels.unWrapId(channelId);
                return _this.unsubscribe(ytChannelId).then(function () {
                    return _this.gOptions.channels.updateChannel(channelId, {
                        subscribed: 0
                    });
                }).catch(function (err) {
                    debug('Unsubscribe event error! %s', channelId, err);
                });
            }
        });
    });
};

PushApi.prototype.initListener = function(resolve) {
    var _this = this;
    var pubsub = this.pubsub;

    pubsub.on("listen", function () {
        resolve();
    });

    pubsub.on('error', function(err) {
        debug('Error', err);
    });

    pubsub.on('denied', function(err) {
        debug('Denied', err);
    });

    pubsub.on('feed', function(data) {
        try {
            var feed = _this.prepareData(data.feed.toString());
            _this.gOptions.events.emit('feed', feed);
        } catch (err) {
            if (err.message === 'Entry is not found!') {
                return;
            }

            debug('Parse xml error!', err);
        }
    });

    this.pubsub.listen(_this.gOptions.config.push.port);
};

PushApi.prototype.subscribe = function(channelId) {
    var _this = this;
    var pubsub = this.pubsub;

    return new Promise(function (resolve, reject) {
        var topicUrl = _this.topic + channelId;
        pubsub.subscribe(topicUrl, _this.hub, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
                // debug('Subscribe %s', channelId);
            }
        });
    }).catch(function (err) {
        debug('Subscribe error %s', channelId, err);

        throw new Error('Subscribe error!');
    });
};

PushApi.prototype.unsubscribe = function(channelList) {
    var _this = this;
    var pubsub = this.pubsub;

    if (!Array.isArray(channelList)) {
        channelList = [channelList];
    }

    var promiseList = channelList.map(function (channelId) {
        return new Promise(function (resolve, reject) {
            var topicUrl = _this.topic + channelId;
            pubsub.unsubscribe(topicUrl, _this.hub, function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                    // debug('Unsubscribed! %s', channelId);
                }
            });
        }).catch(function (err) {
            debug('Unsubscribe error %s', channelId, err);

            throw new Error('Unsubscribe error!');
        });
    });

    return Promise.all(promiseList);
};

PushApi.prototype.prepareData = function(xml) {
    var document = new xmldoc.XmlDocument(xml);

    var getChildNode = function(root, name) {
        var el = null;
        if (!root || !root.children) {
            return el;
        }
        for (var i = 0, node; node = root.children[i]; i++) {
            if (node.name === name) {
                return node;
            }
        }
        return el;
    };

    var entry = getChildNode(document, 'entry');

    if (!entry) {
        var isDeletedEntry = !!getChildNode(document, 'at:deleted-entry');
        if (!isDeletedEntry) {
            debug('Unknown entry %j', document.toString({compressed: true}));
        }
        throw new Error('Entry is not found!');
    }

    var data = {};

    var success = ['yt:videoId', 'yt:channelId'].every(function(item) {
        var node = getChildNode(entry, item);
        if (!node) {
            return false;
        }

        data[item] = node.val;

        return !!data[item];
    });

    if (!success) {
        debug('XML read error! %j', document.toString({compressed: true}));
        throw new Error('XML read error!');
    }

    return data;
};

module.exports = PushApi;