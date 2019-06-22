import ErrorWithCode from "../tools/errorWithCode";
import {struct} from "superstruct";
import RateLimit from "../tools/rateLimit";

const got = require('got');

const rateLimit = new RateLimit(1000);
const gotLimited = rateLimit.wrap(got);

const VideosItemsSnippet = struct.partial({
  items: [struct.partial({
    snippet: struct.partial({
      channelId: 'string'
    })
  })]
});

const ChannelsItemsId = struct.partial({
  items: [struct.partial({
    id: 'string'
  })]
});

const SearchItemsId = struct.partial({
  items: [struct.partial({
    id: struct.partial({
      channelId: 'string'
    })
  })]
});

const SearchItemsSnippet = struct.partial({
  items: [struct.partial({
    snippet: struct.partial({
      channelId: 'string',
      channelTitle: 'string'
    })
  })]
});

class Youtube {
  constructor(/**Main*/main) {
    this.main = main;
    this.name = 'Youtube';
  }

  async requestChannelIdByQuery(query) {
    if (!query) {
      throw new ErrorWithCode('Query is empty', 'QUERY_IS_EMPTY')
    }

    return gotLimited('https://www.googleapis.com/youtube/v3/search', {
      query: {
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: 1,
        fields: 'items(id)',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const searchItemsId = SearchItemsId(body);
      if (!searchItemsId.items.length) {
        throw new ErrorWithCode('Channel by query is not found', 'CHANNEL_BY_QUERY_IS_NOT_FOUND');
      }

      return searchItemsId.items[0].id.channelId;
    });
  }

  async requestChannelIdByUserUrl(url) {
    let username = null;
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
      throw new ErrorWithCode('Is not user url', 'IS_NOT_USER_URL');
    }

    if (!/^[\w\-]+$/.test(username)) {
      return new ErrorWithCode('Incorrect username', 'INCORRECT_USERNAME');
    }

    return gotLimited('https://www.googleapis.com/youtube/v3/channels', {
      query: {
        part: 'snippet',
        forUsername: username,
        maxResults: 1,
        fields: 'items/id',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const channelsItemsId = ChannelsItemsId(body);
      if (!channelsItemsId.items.length) {
        throw new ErrorWithCode('Channel by user is not found', 'CHANNEL_BY_USER_IS_NOT_FOUND');
      }

      return channelsItemsId.items[0].id;
    });
  }

  async requestChannelIdByVideoUrl(url) {
    let videoId = null;
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
      throw new ErrorWithCode('Is not video url', 'IS_NOT_VIDEO_URL');
    }

    return gotLimited('https://www.googleapis.com/youtube/v3/videos', {
      query: {
        part: 'snippet',
        id: videoId,
        maxResults: 1,
        fields: 'items/snippet',
        key: this.main.config.ytToken
      },
      json: true,
    }).then(({body}) => {
      const videosItemsSnippet = VideosItemsSnippet(body);
      if (!videosItemsSnippet.items.length) {
        throw new ErrorWithCode('Video by id is not found', 'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND');
      }

      return videosItemsSnippet.items[0].snippet.channelId;
    });
  }

  async getChannelIdByUrl(url) {
    let channelId = null;
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
      throw new ErrorWithCode('Is not channel url', 'IS_NOT_CHANNEL_URL');
    }

    if (!/^UC/.test(channelId)) {
      throw new ErrorWithCode('Incorrect channel id', 'INCORRECT_CHANNEL_ID');
    }

    return channelId;
  }

  findChannel(query) {
    return this.getChannelIdByUrl(query).catch((err) => {
      if (err.code === 'IS_NOT_CHANNEL_URL') {
        return this.requestChannelIdByVideoUrl(query);
      }
      throw err;
    }).catch((err) => {
      if (err.code === 'IS_NOT_VIDEO_URL') {
        return this.requestChannelIdByUserUrl(query);
      }
      throw err;
    }).catch((err) => {
      if (err.code === 'IS_NOT_USER_URL') {
        return this.requestChannelIdByQuery(query);
      }
      throw err;
    }).then((channelId) => {
      return gotLimited('https://www.googleapis.com/youtube/v3/search', {
        query: {
          part: 'snippet',
          channelId: channelId,
          maxResults: 1,
          fields: 'items/snippet',
          key: this.main.config.ytToken
        },
        json: true,
      }).then(({body}) => {
        const searchItemsSnippet = SearchItemsSnippet(body);
        if (!searchItemsSnippet.items.length) {
          throw new ErrorWithCode('Channel is not found', 'CHANNEL_IS_NOT_FOUND');
        }

        const snippet = searchItemsSnippet.items[0].snippet;
        const name = snippet.channelTitle;
        const id = snippet.channelId;
        const url = getChannelUrl(channelId);
        return {id, name, url};
      });
    });
  }
}

function getChannelUrl(channelId) {
  return 'https://youtube.com/channel/' + encodeURIComponent(channelId);
}

export default Youtube;