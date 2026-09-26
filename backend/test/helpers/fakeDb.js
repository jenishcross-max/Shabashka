// Маленькая база в памяти для тестов рекламы, заявок и токенов. Понимает ровно
// те запросы, которые шлют social/adTracker.js, social/leads.js и
// social/tokens.js, — и падает на любом другом: тест, который вдруг начал
// спрашивать что-то новое, должен об этом узнать, а не получить пустой ответ.
function fakeDb() {
  const campaigns = [];
  const posts = [];
  const settings = new Map();
  let campaignSeq = 0;
  let postSeq = 0;

  const HOUR = 3600 * 1000;
  const ageHours = (row) => (Date.now() - new Date(row.created_at).getTime()) / HOUR;

  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('INSERT INTO ad_campaigns')) {
      const [chatId, importId, title, threadsText, mediaKind, fileId, card, goal] = params;
      const row = {
        id: (campaignSeq += 1),
        chat_id: chatId,
        import_id: importId,
        title,
        threads_text: threadsText,
        media_kind: mediaKind,
        media_file_id: fileId,
        card: card ? JSON.parse(card) : null,
        goal,
        created_at: new Date(),
        warned_at: null,
        reported_at: null,
      };
      campaigns.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (q.startsWith('INSERT INTO ad_posts')) {
      const row = {
        id: (postSeq += 1),
        campaign_id: params[0],
        threads_post_id: params[1],
        permalink: null,
        posted_at: new Date(),
        views: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
        shares: 0,
        checked_at: null,
      };
      posts.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (q.startsWith('UPDATE ad_posts SET permalink')) {
      const post = posts.find((p) => p.id === params[1]);
      if (post) post.permalink = params[0];
      return { rows: [] };
    }
    if (q.startsWith('UPDATE ad_posts SET views')) {
      const post = posts.find((p) => p.id === params[6]);
      if (post) {
        [post.views, post.likes, post.replies, post.reposts, post.quotes, post.shares] = params.slice(0, 6);
        post.checked_at = new Date();
      }
      return { rows: [] };
    }
    if (q === 'SELECT * FROM ad_campaigns WHERE id = $1') {
      return { rows: campaigns.filter((c) => c.id === params[0]) };
    }
    if (q.startsWith('SELECT * FROM ad_posts WHERE campaign_id')) {
      return { rows: posts.filter((p) => p.campaign_id === params[0]) };
    }
    if (q.startsWith('SELECT * FROM ad_campaigns WHERE reported_at IS NULL')) {
      return { rows: campaigns.filter((c) => !c.reported_at && ageHours(c) < 72) };
    }
    if (q.startsWith('SELECT * FROM ad_campaigns WHERE created_at >')) {
      return { rows: campaigns.filter((c) => ageHours(c) < Number(params[0]) * 24).reverse() };
    }
    if (q.startsWith('UPDATE ad_campaigns SET warned_at')) {
      campaigns.find((c) => c.id === params[0]).warned_at = new Date();
      return { rows: [] };
    }
    if (q.startsWith('UPDATE ad_campaigns SET reported_at')) {
      campaigns.find((c) => c.id === params[0]).reported_at = new Date();
      return { rows: [] };
    }
    if (q.startsWith('SELECT c.goal, COALESCE(SUM(p.views), 0)::int AS views')) {
      const rows = campaigns
        .filter((c) => c.reported_at && ageHours(c) < Number(params[0]) * 24)
        .map((c) => ({
          goal: c.goal,
          views: posts.filter((p) => p.campaign_id === c.id).reduce((n, p) => n + p.views, 0),
        }));
      return { rows };
    }
    if (q.startsWith('SELECT threads_post_id FROM ad_posts')) {
      return { rows: posts.map((p) => ({ threads_post_id: p.threads_post_id })) };
    }
    if (q.startsWith('SELECT value FROM app_settings')) {
      return { rows: settings.has(params[0]) ? [{ value: settings.get(params[0]) }] : [] };
    }
    if (q.startsWith('INSERT INTO app_settings')) {
      settings.set(params[0], params[1]);
      return { rows: [] };
    }
    throw new Error(`тестовая база не знает запроса: ${q.slice(0, 120)}`);
  }

  return { query, campaigns, posts, settings };
}

module.exports = { fakeDb };
