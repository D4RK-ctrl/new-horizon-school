const statuses = {
  upcoming: 'Upcoming', active: 'Voting open · demo', closed: 'Voting closed', published: 'Results published',
};

export function statusLabel(status) {
  return Object.hasOwn(statuses, status) ? statuses[status] : 'Status unavailable';
}

export function youtubeUrl(videoId, startSeconds = 0) {
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new TypeError('Invalid YouTube video ID');
  if (!Number.isSafeInteger(startSeconds) || startSeconds < 0) throw new TypeError('Start time must be a nonnegative safe integer');
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', videoId);
  url.searchParams.set('t', `${startSeconds}s`);
  return url.href;
}

export function schoolDate(iso) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}
