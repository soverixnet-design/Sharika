// Fail closed until the production schema, secrets, media and release tests pass.
// Deliberately does not access DB, MEDIA_BUCKET, or any staging service.
export default {
  async fetch() {
    return new Response(JSON.stringify({
      error: 'production_not_ready',
      message: 'Sharika Production API is not enabled yet',
    }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '3600',
      },
    });
  },
};
