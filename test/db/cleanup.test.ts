import {afterEach, describe, expect, jest, test} from '@jest/globals';
import {Op, Sequelize} from 'sequelize';
import Db from '../../src/db/database';
import {initModels, VideoModel} from '../../src/db/models';

describe('Db cleanup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      'cleanChats',
      'DELETE FROM `chats`',
      ['NOT IN (SELECT DISTINCT chatId FROM chatIdChannelId)', '`parentChatId` IS NULL'],
    ],
    [
      'cleanChannels',
      'DELETE FROM `channels`',
      ['NOT IN (SELECT DISTINCT channelId FROM chatIdChannelId)'],
    ],
    ['cleanYtPubSub', 'DELETE FROM `ytPubSubs`', ['`lastPushAt` <']],
    ['cleanVideos', 'DELETE FROM `videos`', ['`publishedAt` <']],
  ] as const)(
    '%s generates a bounded MariaDB DELETE with its eligibility predicate',
    async (method, prefix, conditions) => {
      const sequelize = new Sequelize('test', 'test', 'test', {dialect: 'mariadb', logging: false});
      initModels(sequelize);
      // Exercise SQL generation without opening a database connection.
      const query = jest.spyOn(sequelize, 'query').mockResolvedValue(0 as never);
      const db = Object.create(Db.prototype) as Db;
      await db[method]();
      expect(query).toHaveBeenCalledTimes(1);
      const sql = query.mock.calls[0][0];
      expect(sql).toEqual(expect.stringContaining(prefix));
      expect(sql).toEqual(expect.stringMatching(/ LIMIT 100;?$/));
      for (const condition of conditions) {
        expect(sql).toEqual(expect.stringContaining(condition));
      }
    },
  );

  test('keeps the video cleanup result shape and cutoff across batches', async () => {
    const remove = jest
      .spyOn(VideoModel, 'destroy')
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(7);
    const db = Object.create(Db.prototype) as Db;
    await expect(db.cleanVideos()).resolves.toEqual([107]);
    const first = remove.mock.calls[0][0];
    expect(first).toEqual({limit: 100, where: {publishedAt: {[Op.lt]: expect.any(Date)}}});
    expect(remove.mock.calls[1][0]).toEqual(first);
  });
});
