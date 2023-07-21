const en = {
  help: 'Hi! I will notify you about new videos on Youtube channels!',
  emptyServiceList: `You don't have channels in watchlist, yet.`,
  enterChannelName:
    'Enter the channel video URL (also support channel URL, username, channel id; example: {example}):',
  channelExists: 'This channel has been added!',
  channelAdded: 'Success! The channel {channelName} has been added!',
  telegramChannelEnter: 'Enter the channel name (example: @telegram):',
  telegramChannelSet: 'Success! The channel {channelName} has been assigned!',
  telegramChannelError: `Oops! I can't add a {channelName} channel!`,
  commandCanceled: 'Command {command} was canceled.',
  channelDontExist: `Oops! Can't find a channel in the watchlist!`,
  channelDeleted: 'Success! The channel {channelName} has been deleted!',
  cleared: 'Success! Watchlist has been cleared!',
  selectDelChannel: 'Select the channel you want to delete',
  channelIsNotFound: 'Oops! Channel {channelName} can not be found!',
  clearSure: 'Are you sure?',
  users: 'Users: {count}',
  channels: 'Channels: {count}',
  preview: 'preview',
  groupNote: ['', "Note for groups: Use 'Reply' to answer."].join('\n'),
  about: 'Source code: https://bit.ly/ytWatchBot\nHosting https://m.do.co/c/f6ae2a246c7d',
  'alert_unknown-error': 'Oops something went wrong...',
  'alert_unexpected-error': 'Unexpected error',
  'alert_chat-not-found': 'Telegram chat is not found!',
  'alert_bot-is-not-channel-member': 'Bot is not a member of the channel!',
  'context_options': 'Options:',
  'alert_access-denied': 'Access denied for you ({chat})',
  action_options: 'Options',
  'title_admin-menu': 'Admin menu',
  'alert_command-complete': '{command} complete!',
  'alert_command-error': '{command} error!',
  'action_next-page': '>',
  'action_prev-page': '<',
  action_about: 'About',
  action_top: 'Top 10',
  'action_show-channels': 'Show the channel list',
  'action_delete-channel': 'Delete channel',
  action_add_channel: 'Add channel',
  'action_show-preview': 'Show preview',
  'action_hide-preview': 'Hide preview',
  'action_remove-tg-channel': 'Remove channel ({channel})',
  'action_set-tg-channel': 'Set channel',
  'action_mute-chat': 'Mute this chat',
  'action_unmute-chat': 'Unmute this chat',
  'action_show-preview-for-channel': 'Show preview for channel',
  'action_hide-preview-for-channel': 'Hide preview for channel',
};

export default en;
