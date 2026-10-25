/**
 * Same-origin API proxy for Quiz Lab.
 * Configure QUIZLAB_GAS_URL in Netlify environment variables to the deployed
 * Google Apps Script Web App URL ending in /exec.
 */
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Allow': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Allow': 'POST, OPTIONS' }, body: JSON.stringify({ ok: false, error: 'Chỉ hỗ trợ POST.' }) };
  }

  const gasUrl = process.env.QUIZLAB_GAS_URL;
  if (!gasUrl || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(gasUrl)) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'Chưa cấu hình QUIZLAB_GAS_URL trong Netlify. Giá trị phải là URL Apps Script kết thúc bằng /exec.' }) };
  }

  try {
    let request;
    try { request = JSON.parse(event.body || '{}'); }
    catch (_) { return { statusCode: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ ok: false, error: 'Dữ liệu gửi lên không phải JSON hợp lệ.' }) }; }

    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      redirect: 'follow'
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch (_) { payload = { ok: false, error: 'Apps Script không trả về JSON. Hãy kiểm tra quyền truy cập triển khai Web app.' }; }

    return {
      statusCode: response.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify(payload)
    };
  } catch (error) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: 'Không gọi được Apps Script. Hãy kiểm tra URL triển khai và quyền truy cập.' }) };
  }
};
