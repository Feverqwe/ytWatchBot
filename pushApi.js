/**
 * Created by Anton on 18.12.2015.
 */
var debug = require('debug')('pubsub');
var pubSubHubbub = require("pubsubhubbub");
var Promise = require('bluebird');
var xmldoc = require("xmldoc");

var PushApi = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    this.topic = 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=';
    this.hub = 'https://pubsubhubbub.appspot.com/subscribe';

    this.pubsub = pubSubHubbub.createServer(this.gOptions.config.push);

    this.onReady = new Promise(function(resolve) {
        _this.initListener(resolve);
    });

    _this.gOptions.events.on('subscribe', function(channelList) {
        if (!Array.isArray(channelList)) {
            channelList = [channelList];
        }

        var dDblList = [];

        channelList.forEach(function(channelName) {
            _this.gOptions.services.youtube.requestChannelIdByUsername(channelName).then(function (channelId) {
                if (dDblList.indexOf(channelId) !== -1) {
                    return;
                }
                dDblList.push(channelId);

                return _this.subscribe(channelId);
            }).catch(function (err) {
                debug('Subscribe event error! %s %j', channelName, err);
            });
        });
    });

    _this.gOptions.events.on('unsubscribe', function(channelList) {
        if (!Array.isArray(channelList)) {
            channelList = [channelList];
        }

        var dDblList = [];

        channelList.forEach(function(channelName) {
            _this.gOptions.services.youtube.requestChannelIdByUsername(channelName).then(function (channelId) {
                if (dDblList.indexOf(channelId) !== -1) {
                    return;
                }
                dDblList.push(channelId);

                return _this.unsubscribe(channelId);
            }).catch(function (err) {
                debug('Unsubscribe event error! %s %j', channelName, err);
            });
        });
    });
};

PushApi.prototype.initListener = function(resolve) {
    "use strict";
    var _this = this;
    var pubsub = this.pubsub;

    pubsub.on("listen", function () {
        resolve();
    });

    pubsub.on('error', function(err) {
        debug('Error %j', err);
    });

    pubsub.on('denied', function(err) {
        debug('Denied %j', err);
    });

    pubsub.on('feed', function(data) {
        Promise.try(function() {
            return _this.prepareData(data.feed.toString());
        }).then(function(data) {
            _this.gOptions.events.emit('feed', data);
        }).catch(function(err) {
            if (err === 'Entry is not found!') {
                return;
            }

            debug('Parse xml error! %s', err);
        });
    });

    this.pubsub.listen(_this.gOptions.config.push.port);
};

PushApi.prototype.subscribe = function(channelList) {
    "use strict";
    var _this = this;
    var pubsub = this.pubsub;

    if (!Array.isArray(channelList)) {
        channelList = [channelList];
    }

    return Promise.try(function() {
        var promiseList = [];
        channelList.forEach(function (channelId) {
            var promise = new Promise(function (resolve, reject) {
                var topicUrl = _this.topic + channelId;
                pubsub.subscribe(topicUrl, _this.hub, function (err) {
                    if (err) {
                        return reject(err);
                    }
                    // debug('Subscribe %s', channelId);
                    resolve();
                });
            }).catch(function (err) {
                debug('Subscribe error %s %j', channelId, err);

                throw 'Subscribe error!';
            });

            promiseList.push(promise);
        });

        return Promise.all(promiseList);
    });
};

PushApi.prototype.unsubscribe = function(channelList) {
    "use strict";
    var _this = this;
    var pubsub = this.pubsub;

    if (!Array.isArray(channelList)) {
        channelList = [channelList];
    }

    return Promise.try(function() {
        var promiseList = [];
        channelList.forEach(function (channelId) {
            var promise = new Promise(function (resolve, reject) {
                var topicUrl = _this.topic + channelId;
                pubsub.unsubscribe(topicUrl, _this.hub, function (err) {
                    if (err) {
                        return reject(err);
                    }
                    // debug('Unsubscribed! %s', channelId);
                    resolve();
                });
            }).catch(function (err) {
                debug('Unsubscribe error %s %j', channelId, err);

                throw 'Unsubscribe error!';
            });

            promiseList.push(promise);
        });

        return Promise.all(promiseList);
    });
};

PushApi.prototype.prepareData = function(xml) {
    "use strict";
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
        throw 'Entry is not found!';
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
        throw 'XML read error!';
    }

    return data;
};

module.exports = PushApi;