/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debugLog = require('debug')('app:youtube:log');
debugLog.log = console.log.bind(console);
const debug = require('debug')('app:youtube');
const base = require('../base');
const CustomError = require('../customError').CustomError;
const got = require('got');
const parallel = require('../tools/parallel');
const Quote = require('../tools/quote');

const apiQuote = new Quote(1000);
const gotLimited = apiQuote.wrap(got);

class Youtube {
    constructor(options) {
        this.gOptions = options;
        this.config = {};
        this.config.token = options.config.ytToken;
        this.channels = options.channels;
        this.name = 'youtube';
    }

    getChannelUrl(channelId) {
        return 'https://youtube.com/channel/' + channelId;
    }

    getFullCheckTime(factor) {
        if (!factor) {
            factor = 1;
        }
        return new Date((parseInt(Date.now() / 1000) - factor * 3 * 24 * 60 * 60) * 1000).toISOString();
    }

    clean() {
        const db = this.gOptions.db;
        return Promise.resolve().then(() => {
            return this.channels.removeUnusedChannels();
        }).then(() => {
            return new Promise((resolve, reject) => {
                db.connection.query('\
                DELETE FROM messages WHERE publishedAt < ?; \
            ', [this.getFullCheckTime(2)], (err, results) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * @param {String} id
     * @return {Promise}
     */
    videoIdInList(id) {
        const db = this.gOptions.db;
        return new Promise((resolve, reject) => {
            db.connection.query('\
            SELECT id FROM messages WHERE id = ? LIMIT 1; \
        ', [id], (err, results) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(!!results.length);
                }
            });
        });
    }

    /**
     * @typedef {{}} VideoSnippet
     * @property {String} publishedAt // 2017-02-18T01:00:00.000Z
     * @property {String} channelId
     * @property {String} title
     * @property {String} description
     * @property {{}} thumbnails
     * @property {{}} thumbnails.default
     * @property {String} thumbnails.default.url
     * @property {String} thumbnails.default.width
     * @property {String} thumbnails.default.height
     * @property {{}} thumbnails.medium
     * @property {String} thumbnails.medium.url
     * @property {String} thumbnails.medium.width
     * @property {String} thumbnails.medium.height
     * @property {{}} thumbnails.high
     * @property {String} thumbnails.high.url
     * @property {String} thumbnails.high.width
     * @property {String} thumbnails.high.height
     * @property {{}} thumbnails.standard
     * @property {String} thumbnails.standard.url
     * @property {String} thumbnails.standard.width
     * @property {String} thumbnails.standard.height
     * @property {{}} thumbnails.maxres
     * @property {String} thumbnails.maxres.url
     * @property {String} thumbnails.maxres.width
     * @property {String} thumbnails.maxres.height
     * @property {String} channelTitle
     * @property {String} type
     * @property {String} groupId
     */

    /**
     * @typedef {{}} VideoDetails
     * @property {string} duration
     * @property {string} dimension
     * @property {string} definition
     * @property {string} caption
     * @property {string} licensedContent
     * @property {string} projection
     */
    /**
     * @param {dbChannel} channel
     * @param {String[]} chatIdList
     * @param {string} id
     * @param {VideoSnippet} snippet
     * @param {VideoDetails} contentDetails
     * @returns {Promise}
     */
    insertItem(channel, chatIdList, id, snippet, contentDetails) {
        const db = this.gOptions.db;
        const previewList = Object.keys(snippet.thumbnails).map((quality) => {
            return snippet.thumbnails[quality];
        }).sort((a, b) => {
            return a.width > b.width ? -1 : 1;
        }).map((item) => {
            return item.url;
        });
        const data = {
            url: 'https://youtu.be/' + id,
            title: snippet.title,
            preview: previewList,
            duration: formatDuration(contentDetails.duration),
            channel: {
                title: snippet.channelTitle,
                id: channel.id
            }
        };
        const item = {
            id: this.channels.wrapId(id, this.name),
            channelId: channel.id,
            publishedAt: snippet.publishedAt,
            data: JSON.stringify(data)
        };
        const insert = (item) => {
            return db.transaction((connection) => {
                return new Promise((resolve, reject) => {
                    connection.query('INSERT INTO messages SET ?', item, (err, results) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(item.id);
                        }
                    });
                }).then((messageId) => {
                    return this.gOptions.msgStack.addChatIdsMessageId(connection, chatIdList, messageId);
                });
            });
        };
        return insert(item).catch((err) => {
            if (err.code !== 'ER_DUP_ENTRY') {
                debug('insertItem', err);
            }
        }).then(() => {
            debugLog('[insert] %s %j', item.id, item);
        });
    }

    /**
     * @param {dbChannel[]} _channelList
     * @param {boolean} [isFullCheck]
     * @return {Promise}
     */
    getVideoList(_channelList, isFullCheck) {
        const getVideoIdsInfo = (channel, ytVideoIds, chatIdList) => {
            let lastPublishedAt = '';
            let channelTitle = '';
            let pageLimit = 100;
            /**
             * @param {String} [pageToken]
             * @return {Promise}
             */
            const getPage = (pageToken) => {
                let retryLimit = 5;
                const requestPage = () => {
                    return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
                        query: {
                            part: 'snippet,contentDetails',
                            id: ytVideoIds.join(','),
                            pageToken: pageToken,
                            fields: 'items/id,items/snippet,items/contentDetails,nextPageToken',
                            key: this.config.token
                        },
                        json: true,
                    }).catch((err) => {
                        const isDailyLimitExceeded = isDailyLimitExceeded(err);
                        if (isDailyLimitExceeded || retryLimit-- < 1) {
                            throw err;
                        }
                        return new Promise(resolve => setTimeout(resolve, 250)).then(() => {
                            return requestPage();
                        });
                    });
                };
                /**
                 * @typedef {{}} v3Videos
                 * @property {string} nextPageToken
                 * @property {[{id: string,snippet:VideoSnippet,contentDetails:{}}]} items
                 */
                return requestPage().then((/*v3Videos*/ {body: responseBody}) => {
                    const items = responseBody.items;
                    return parallel(1, items, (item) => {
                        const id = item.id;
                        const snippet = item.snippet;
                        const contentDetails = item.contentDetails;
                        if (lastPublishedAt < snippet.publishedAt) {
                            lastPublishedAt = snippet.publishedAt;
                        }
                        if (channelTitle !== snippet.channelTitle) {
                            channelTitle = snippet.channelTitle;
                        }
                        return this.insertItem(channel, chatIdList, id, snippet, contentDetails);
                    }).then(() => {
                        if (responseBody.nextPageToken) {
                            if (pageLimit-- < 1) {
                                throw new CustomError('Page limit reached ' + channel.id);
                            }
                            return getPage(responseBody.nextPageToken);
                        }
                    });
                });
            };
            return getPage().then(() => {
                let isChange = false;
                if (lastPublishedAt) {
                    channel.publishedAfter = lastPublishedAt;
                    isChange = true;
                }
                if (channelTitle && channel.title !== channelTitle) {
                    channel.title = channelTitle;
                    isChange = true;
                }
                if (isChange) {
                    return this.channels.updateChannel(channel.id, channel);
                }
            }).catch((err) => {
                debug('getVideos error! %s', channel.id, err);
            });
        };

        const requestNewVideoIds = (/*dbChannel*/ channel) => {
            const newVideoIds = [];
            const channelId = channel.id;
            let publishedAfter = channel.publishedAfter;
            if (isFullCheck || !publishedAfter) {
                publishedAfter = this.getFullCheckTime();
            } else {
                publishedAfter = (new Date(new Date(publishedAfter).getTime() + 1000)).toISOString();
            }
            let pageLimit = 100;
            /**
             * @param {String} [pageToken]
             * @return {Promise}
             */
            const getPage = (pageToken) => {
                let retryLimit = 5;
                const requestPage = () => {
                    return gotLimited('https://www.googleapis.com/youtube/v3/activities', {
                        query: {
                            part: 'contentDetails',
                            channelId: this.channels.unWrapId(channelId),
                            maxResults: 50,
                            pageToken: pageToken,
                            fields: 'items/contentDetails/upload/videoId,nextPageToken',
                            publishedAfter: publishedAfter,
                            key: this.config.token
                        },
                        json: true,
                    }).catch((err) => {
                        const isDailyLimitExceeded = isDailyLimitExceeded(err);
                        if (isDailyLimitExceeded || retryLimit-- < 1) {
                            throw err;
                        }
                        return new Promise(resolve => setTimeout(resolve, 250)).then(() => {
                            return requestPage();
                        });
                    });
                };
                /**
                 * @typedef {{}} v3Activities
                 * @property {string} nextPageToken
                 * @property {[{contentDetails:{upload:{videoId:string}}}]} items
                 */
                return requestPage().then((/*v3Activities*/ {body: responseBody}) => {
                    const items = responseBody.items;
                    const idVideoIdMap = {};
                    const ids = [];
                    items.forEach((item) => {
                        const ytVideoId = item.contentDetails.upload.videoId;
                        const videoId = this.channels.wrapId(ytVideoId, this.name);
                        if (ids.indexOf(videoId) === -1) {
                            ids.push(videoId);
                            idVideoIdMap[videoId] = ytVideoId;
                        }
                    });
                    return this.gOptions.msgStack.messageIdsExists(ids).then((exIds) => {
                        ids.forEach((id) => {
                            if (exIds.indexOf(id) === -1) {
                                newVideoIds.unshift(idVideoIdMap[id]);
                            }
                        });
                    }).then(() => {
                        if (responseBody.nextPageToken) {
                            if (pageLimit-- < 1) {
                                throw new CustomError('Page limit reached ' + channelId);
                            }
                            return getPage(responseBody.nextPageToken);
                        }
                    });
                });
            };
            return getPage().catch((err) => {
                debug('requestPages error! %s', channelId, err);
            }).then(() => {
                return newVideoIds;
            });
        };

        return Promise.resolve().then(() => {
            if (isFullCheck) {
                return this.clean();
            }
        }).then(() => {
            return parallel(10, _channelList, (channel) => {
                return this.gOptions.users.getChatIdsByChannel(channel.id).then((chatIdList) => {
                    if (!chatIdList.length)
                        return;
                    return requestNewVideoIds(channel).then((ytVideoIds) => {
                        const ytVideoIdsParts = base.arrToParts(ytVideoIds, 50);
                        return parallel(1, ytVideoIdsParts, (ytVideoIdsPart) => {
                            return getVideoIdsInfo(channel, ytVideoIdsPart, chatIdList);
                        });
                    });
                });
            });
        }).then(() => {
            this.gOptions.events.emit('subscribe', _channelList);
        });
    }

    /**
     * @param {dbChannel} channel
     * @return {Promise.<dbChannel>}
     */
    channelExists(channel) {
        const channelId = this.channels.unWrapId(channel.id);
        return this.getChannelId(channelId);
    }

    /**
     * @param {String} rawQuery
     * @return {Promise.<string>}
     */
    requestChannelIdByQuery(rawQuery) {
        let query = '';
        [
            /youtube\.com\/(?:#\/)?c\/([\w\-]+)/i
        ].some((re) => {
            const m = re.exec(rawQuery);
            if (m) {
                query = m[1];
                return true;
            }
        });
        if (!query) {
            query = rawQuery;
        }
        return gotLimited('https://www.googleapis.com/youtube/v3/search', {
            query: {
                part: 'snippet',
                q: query,
                type: 'channel',
                maxResults: 1,
                fields: 'items(id)',
                key: this.config.token
            },
            json: true,
        }).then(({body: responseBody}) => {
            let channelId = '';
            responseBody.items.some((item) => {
                return channelId = item.id.channelId;
            });
            if (!channelId) {
                throw new CustomError('Channel ID is not found by query!');
            }
            return channelId;
        });
    }

    /**
     * @param {String} url
     * @return {Promise.<String>}
     */
    requestChannelIdByUsername(url) {
        let username = '';
        [
            /youtube\.com\/(?:#\/)?user\/([\w\-]+)/i,
            /youtube\.com\/([\w\-]+)/i
        ].some((re) => {
            const m = re.exec(url);
            if (m) {
                username = m[1];
                return true;
            }
        });
        if (!username) {
            username = url;
        }
        if (!/^[\w\-]+$/.test(username)) {
            return Promise.reject(new CustomError('It is not username!'));
        }
        return gotLimited('https://www.googleapis.com/youtube/v3/channels', {
            query: {
                part: 'snippet',
                forUsername: username,
                maxResults: 1,
                fields: 'items/id',
                key: this.config.token
            },
            json: true,
        }).then(({body: responseBody}) => {
            let id = '';
            responseBody.items.some((item) => {
                return id = item.id;
            });
            if (!id) {
                throw new CustomError('Channel ID is not found by username!');
            }
            return id;
        });
    }

    /**
     * @param {String} url
     * @returns {Promise.<String>}
     */
    getChannelIdByUrl(url) {
        let channelId = '';
        [
            /youtube\.com\/(?:#\/)?channel\/([\w\-]+)/i
        ].some((re) => {
            const m = re.exec(url);
            if (m) {
                channelId = m[1];
                return true;
            }
        });
        if (!channelId) {
            channelId = url;
        }
        if (!/^UC/.test(channelId)) {
            return Promise.reject(new CustomError('It is not channel url!'));
        }
        return Promise.resolve(channelId);
    }

    /**
     * @param {String} url
     * @return {Promise.<string>}
     */
    requestChannelIdByVideoUrl(url) {
        let videoId = '';
        [
            /youtu\.be\/([\w\-]+)/i,
            /youtube\.com\/.+[?&]v=([\w\-]+)/i,
            /youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/i
        ].some((re) => {
            const m = re.exec(url);
            if (m) {
                videoId = m[1];
                return true;
            }
        });
        if (!videoId) {
            return Promise.reject(new CustomError('It is not video url!'));
        }
        return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
            query: {
                part: 'snippet',
                id: videoId,
                maxResults: 1,
                fields: 'items/snippet',
                key: this.config.token
            },
            json: true,
        }).then(({body: responseBody}) => {
            let channelId = '';
            responseBody.items.some((item) => {
                return channelId = item.snippet.channelId;
            });
            if (!channelId) {
                throw new CustomError('Channel ID is empty');
            }
            return channelId;
        });
    }

    /**
     /add https://www.youtube.com/user/ThePrimeThanatos
     /add ThePrimeThanatos
     /add Premium Extensions HQ
     /add https://www.youtube.com/watch?v=SF58Lsvqg5E
     /add https://www.youtube.com/channel/UCmYTgpKxd-QOJCPDrmaXuqQ
     /add https://www.youtube.com/c/UCmYTgpKxd-QOJCPDrmaXuqQ
     /add UCmYTgpKxd-QOJCPDrmaXuqQ
     /add https://www.youtube.com/user/ChromeDevelopers/videos
     /add https://www.youtube.com/ChromeDevelopers
     */
    /**
     * @param {String} channelName
     * @return {Promise.<dbChannel>}
     */
    getChannelId(channelName) {
        return this.getChannelIdByUrl(channelName).catch((err) => {
            if (!(err instanceof CustomError)) {
                throw err;
            }
            return this.requestChannelIdByVideoUrl(channelName).catch((err) => {
                if (!(err instanceof CustomError)) {
                    throw err;
                }
                return this.requestChannelIdByUsername(channelName).catch((err) => {
                    if (!(err instanceof CustomError)) {
                        throw err;
                    }
                    return this.requestChannelIdByQuery(channelName);
                });
            });
        }).then((channelId) => {
            return gotLimited('https://www.googleapis.com/youtube/v3/search', {
                query: {
                    part: 'snippet',
                    channelId: channelId,
                    maxResults: 1,
                    fields: 'items/snippet',
                    key: this.config.token
                },
                json: true,
            }).then(({body: responseBody}) => {
                let snippet = null;
                responseBody.items.some((item) => {
                    return snippet = item.snippet;
                });
                if (!snippet) {
                    throw new CustomError('Channel is not found');
                }
                const title = snippet.channelTitle;
                const url = this.getChannelUrl(channelId);
                return this.channels.insertChannel(channelId, this.name, title, url).then((channel) => {
                    return this.channels.getChannels([channel.id]).then((channels) => {
                        return channels[0];
                    });
                });
            });
        });
    }
}

// from momentjs
const isoRegex = /^PT(?:(-?[0-9,.]*)H)?(?:(-?[0-9,.]*)M)?(?:(-?[0-9,.]*)S)?$/;
const parseIso = (inp) => {
    const res = inp && parseFloat(inp.replace(',', '.'));
    return (!Number.isFinite(res) ? 0 : res);
};

const formatDuration = (str) => {
    let result = '';
    const match = isoRegex.exec(str);
    if (!match) {
        debug('formatDuration error', str);
    } else {
        const parts = [
            parseIso(match[1]),
            parseIso(match[2]),
            parseIso(match[3])
        ];
        if (parts[0] === 0) {
            parts.shift();
        }
        result = parts.map((count, index) => {
            if (index > 0 && count < 10) {
                count = '0' + count;
            }
            return count;
        }).join(':');
    }
    return result;
};

function isDailyLimitExceeded(err) {
    if (err.name === 'HTTPError' && err.statusCode === 403 && err.body && err.body.error && err.body.error.code === 403 && /Daily Limit Exceeded/.test(err.body.error.message)) {
        return true;
    }
    return false;
}

module.exports = Youtube;