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

    var line = [];
    if (videoItem.title) {
        line.push(videoItem.title);
    }
    if (videoItem.channel.title) {
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

    var line = [];
    if (videoItem.title) {
        line.push(this.markDownSanitize(videoItem.title));
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    line = [];
    if (videoItem.url) {
        var channelName = '*' + this.markDownSanitize(videoItem.channel.title, '*') + '*';
        line.push(gOptions.language.watchOn
            .replace('{channelName}', channelName)
            .replace('{serviceName}', '['+gOptions.serviceToTitle[videoItem._service]+']'+'('+videoItem.url+')')
        );
    }
    if (videoItem.preview) {
        line.push('['+gOptions.language.preview+']' + '('+videoItem.preview+')');
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    return textArr.join('\n');
};

/**
 *
 * @param gOptions
 * @param {{
 * channel: {display_name},
 * viewers,
 * game,
 * _service,
 * preview,
 * _isOffline,
 * _channelName
 * }} stream
 * @returns {string}
 */
module.exports.getStreamText = function(gOptions, stream) {
    var textArr = [];

    textArr.push('*' + this.markDownSanitize(stream.channel.title, '*') + '*');

    var line = [];
    if (stream.title) {
        line.push(this.markDownSanitize(stream.title));
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    line = [];
    if (stream.url) {
        line.push(gOptions.language.watchOn
            .replace('{channelName} ', '')
            .replace('{serviceName}', '['+gOptions.serviceToTitle[stream._service]+']'+'('+stream.url+')')
        );
    }
    if (stream.preview) {
        line.push('['+gOptions.language.preview+']' + '('+stream.preview+')');
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    return textArr.join('\n');
};