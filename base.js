/**
 * Created by Anton on 06.12.2015.
 */
var path = require('path');
var Promise = require('bluebird');
var LocalStorage = require('node-localstorage').LocalStorage;
var localStorage = null;

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadConfig = function() {
    "use strict";
    return Promise.resolve().then(function() {
        var fs = require('fs');
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
    });
};

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadLanguage = function() {
    "use strict";
    return Promise.resolve().then(function() {
        var fs = require('fs');

        var language = JSON.parse(fs.readFileSync(path.join(__dirname, 'language.json')));

        for (var key in language) {
            var item = language[key];
            if (Array.isArray(item)) {
                item = item.join('\n');
            }
            language[key] = item;
        }

        return language;
    });
};

var Storage = function() {
    "use strict";
    localStorage = new LocalStorage(path.join(__dirname, './storage'));

    this.get = function(arr) {
        return Promise.resolve().then(function() {
            var key, obj = {};
            if (!Array.isArray(arr)) {
                arr = [arr];
            }
            for (var i = 0, len = arr.length; i < len; i++) {
                key = arr[i];
                var value = localStorage.getItem(key);
                if (value) {
                    obj[key] = JSON.parse(value);
                }
            }
            return obj;
        });
    };
    this.set = function(obj) {
        return Promise.resolve().then(function() {
            for (var key in obj) {
                var value = obj[key];
                if (value === undefined) {
                    localStorage.removeItem(key);
                    continue;
                }
                localStorage.setItem(key, JSON.stringify(value));
            }
        });
    };
    this.remove = function(arr) {
        return Promise.resolve().then(function() {
            if (!Array.isArray(arr)) {
                arr = [arr];
            }

            for (var i = 0, len = arr.length; i < len; i++) {
                localStorage.removeItem(arr[i]);
            }
        });
    };
};

module.exports.storage = new Storage();

module.exports.markDownSanitize = function(text, char) {
    "use strict";
    if (char === '*') {
        text = text.replace(/\*/g, String.fromCharCode(735));
    }
    if (char === '_') {
        text = text.replace(/_/g, String.fromCharCode(717));
    }
    if (char === '[') {
        text = text.replace(/\[/g, '(');
        text = text.replace(/\]/g, ')');
    }
    if (!char) {
        text = text.replace(/([*_\[])/g, '\\$1');
    }

    return text;
};

module.exports.getDate = function() {
    "use strict";
    var today = new Date();
    var h = today.getHours();
    var m = today.getMinutes();
    var s = today.getSeconds();
    if (h < 10) {
        h = '0' + h;
    }
    if (m < 10) {
        m = '0' + m;
    }
    if (s < 10) {
        s = '0' + s;
    }
    return today.getDate() + "/"
        + (today.getMonth()+1)  + "/"
        + today.getFullYear() + " @ "
        + h + ":"
        + m + ":"
        + s;
};

module.exports.getNowStreamPhotoText = function(gOptions, videoItem) {
    "use strict";
    var textArr = [];

    var title = '';

    var line = [];
    if (videoItem.title) {
        line.push(title = videoItem.title);
    }
    if (videoItem.channel.title && title.indexOf(videoItem.channel.title) === -1) {
        line.push(videoItem.channel.title);
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    if (videoItem.url) {
        textArr.push(videoItem.url);
    }

    return textArr.join('\n');
};

module.exports.getNowStreamText = function(gOptions, videoItem) {
    "use strict";
    var textArr = [];

    var title = '';

    var line = [];
    if (videoItem.title) {
        line.push(this.markDownSanitize(title = videoItem.title));
    }
    if (videoItem.channel.title && title.indexOf(videoItem.channel.title) === -1) {
        line.push('_' + this.markDownSanitize(videoItem.channel.title, '_') + '_');
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    line = [];
    if (videoItem.url) {
        line.push(this.markDownSanitize(videoItem.url));
    }
    if (videoItem.preview) {
        var url = Array.isArray(videoItem.preview) ? videoItem.preview[0] : videoItem.preview;
        if (url) {
            line.push('[' + gOptions.language.preview + ']' + '(' + url + ')');
        }
    }
    if (line.length) {
        textArr.push(line.join(' , '));
    }

    return textArr.join('\n');
};

module.exports.extend = function() {
    "use strict";
    var obj = arguments[0];
    for (var i = 1, len = arguments.length; i < len; i++) {
        var item = arguments[i];
        for (var key in item) {
            obj[key] = item[key];
        }
    }
    return obj;
};

module.exports.getChannelTitle = function(gOptions, service, channelName) {
    "use strict";
    var title = channelName;

    var services = gOptions.services;
    if (services[service].getChannelTitle) {
        title = services[service].getChannelTitle(channelName);
    }

    return title;
};

module.exports.getChannelLocalTitle = function(gOptions, service, channelName) {
    "use strict";
    var title = channelName;

    var services = gOptions.services;
    if (services[service].getChannelLocalTitle) {
        title = services[service].getChannelLocalTitle(channelName);
    }

    return title;
};

module.exports.getChannelUrl = function(service, channelName) {
    "use strict";
    var url = '';
    if (service === 'youtube') {
        url = 'https://youtube.com/';
        if (/^UC/.test(channelName)) {
            url += 'channel/';
        } else {
            url += 'user/';
        }
        url += channelName;
    }

    return url;
};

var getTime = function() {
    "use strict";
    return parseInt(Date.now() / 1000);
};

var sendTime = {};
var cbQuote = [];

var nextQuoteItem = function () {
    "use strict";
    var promiseList = cbQuote.slice(0, 30).map(function(item, index) {
        cbQuote[index] = null;
        return Promise.try(function() {
            var cb = item[0];
            var args = item[1];
            var resolve = item[2];
            var reject = item[3];

            return Promise.try(function() {
                return cb.apply(null, args);
            }).then(resolve).catch(reject);
        });
    });

    var count = promiseList.length;

    var now = getTime();
    if (!sendTime[now]) {
        for (var key in sendTime) {
            delete sendTime[key];
        }
        sendTime[now] = 0;
    }
    sendTime[now] += count;

    Promise.all(promiseList).then(function() {
        var now = getTime();
        if (!sendTime[now] || sendTime[now] < 30) {
            return;
        }

        return new Promise(function(resolve) {
            setTimeout(resolve, 1000);
        });
    }).then(function() {
        cbQuote.splice(0, count);
        if (cbQuote.length) {
            nextQuoteItem();
        }
    });
};

module.exports.quoteWrapper = function(cb) {
    "use strict";
    return function () {
        var args = [];
        for (var i = 0, len = arguments.length; i < len; i++) {
            args.push(arguments[i]);
        }

        return new Promise(function(resolve, reject) {
            cbQuote.push([cb, args, resolve, reject]);
            if (cbQuote.length > 1) {
                return;
            }

            nextQuoteItem();
        });
    };
};