const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Create axios instance with longer timeout
const client = axios.create({
    timeout: 60000, // 60 seconds
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
});

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Home
app.get('/', (req, res) => {
    res.json({
        name: '🎬 TeraBox Downloader API',
        status: 'online',
        endpoints: {
            '/api/get?url=': 'Get file info and download link'
        },
        example: '/api/get?url=https://1024terabox.com/s/1xxxxx',
        note: 'First request may take 30-60 seconds'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Main API
app.get('/api/get', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.json({ success: false, error: 'URL parameter required' });
    }

    console.log('📥 Processing:', url);
    const startTime = Date.now();

    try {
        const result = await getTeraboxData(url);
        console.log(`✅ Done in ${Date.now() - startTime}ms`);
        res.json(result);
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// Alias
app.get('/api/list', (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.json({ success: false, error: 'URL required' });
    }
    res.redirect(`/api/get?url=${encodeURIComponent(url)}`);
});

async function getTeraboxData(shareUrl) {
    const errors = [];

    // Method 1: Try NepCoder API
    try {
        console.log('Trying API 1...');
        const result = await tryNepCoderApi(shareUrl);
        if (result.success) return result;
    } catch (e) {
        errors.push('API1: ' + e.message);
    }

    // Method 2: Try Uday API
    try {
        console.log('Trying API 2...');
        const result = await tryUdayApi(shareUrl);
        if (result.success) return result;
    } catch (e) {
        errors.push('API2: ' + e.message);
    }

    // Method 3: Try direct TeraBox API
    try {
        console.log('Trying Direct API...');
        const result = await tryDirectApi(shareUrl);
        if (result.success) return result;
    } catch (e) {
        errors.push('Direct: ' + e.message);
    }

    // Method 4: Try page scraping
    try {
        console.log('Trying Scrape...');
        const result = await tryPageScrape(shareUrl);
        if (result.success) return result;
    } catch (e) {
        errors.push('Scrape: ' + e.message);
    }

    return {
        success: false,
        error: 'All methods failed',
        details: errors
    };
}

// NepCoder API
async function tryNepCoderApi(url) {
    const apiUrl = `https://teraboxvideodownloader.nepcoderdevs.workers.dev/api/get-info?data=${encodeURIComponent(url)}`;

    const response = await client.get(apiUrl);
    const data = response.data;

    if (!data) throw new Error('Empty response');

    if (data.file_name || data.resolutions || data.download_link) {
        return {
            success: true,
            data: {
                filename: data.file_name || 'Unknown',
                size: data.size || data.sizebytes || 0,
                sizeFormatted: formatSize(data.size || data.sizebytes),
                thumb: data.thumb || null,
                downloadUrl: data.download_link || data.dlink || null,
                resolutions: data.resolutions || null,
                fastDownload: data.resolutions?.['Fast Download'] || null,
                hdVideo: data.resolutions?.['HD Video'] || null
            },
            source: 'nepcoderdevs'
        };
    }

    throw new Error('Invalid response format');
}

// Uday API
async function tryUdayApi(url) {
    const apiUrl = `https://terabox.udayscriptsx.workers.dev/api/get-info?data=${encodeURIComponent(url)}`;

    const response = await client.get(apiUrl);
    const data = response.data;

    if (!data) throw new Error('Empty response');

    if (data.file_name || data.download_link) {
        return {
            success: true,
            data: {
                filename: data.file_name || 'Unknown',
                size: data.size || 0,
                sizeFormatted: formatSize(data.size),
                thumb: data.thumb || null,
                downloadUrl: data.download_link || data.dlink || null,
                resolutions: data.resolutions || null
            },
            source: 'udayscripts'
        };
    }

    throw new Error('Invalid response format');
}

// Direct TeraBox API
async function tryDirectApi(url) {
    const surl = extractSurl(url);
    const baseUrl = getBaseUrl(url);

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': `${baseUrl}/s/${surl}`
    };

    // Get share info
    const infoUrl = `${baseUrl}/api/shorturlinfo?shorturl=${surl}&root=1`;
    const infoRes = await client.get(infoUrl, { headers });

    if (infoRes.data.errno !== 0) {
        throw new Error('Share info error: ' + (infoRes.data.errmsg || infoRes.data.errno));
    }

    const shareInfo = {
        shareid: infoRes.data.shareid,
        uk: infoRes.data.uk,
        sign: infoRes.data.sign,
        timestamp: infoRes.data.timestamp
    };

    // Get file list
    const listUrl = `${baseUrl}/share/list?shorturl=${surl}&dir=/&root=1&page=1&num=100`;
    const listRes = await client.get(listUrl, { headers });

    if (listRes.data.errno !== 0) {
        throw new Error('File list error: ' + (listRes.data.errmsg || listRes.data.errno));
    }

    const files = (listRes.data.list || []).map(f => ({
        fs_id: String(f.fs_id),
        filename: f.server_filename,
        size: f.size,
        sizeFormatted: formatSize(f.size),
        isDir: f.isdir === 1,
        dlink: f.dlink || null,
        thumb: f.thumbs?.url3 || f.thumbs?.url2 || null
    }));

    if (files.length === 0) {
        throw new Error('No files found');
    }

    return {
        success: true,
        data: {
            files,
            shareInfo
        },
        source: 'direct'
    };
}

// Page Scrape
async function tryPageScrape(url) {
    const response = await client.get(url, {
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });

    const html = response.data;

    if (html.includes('verify') || html.includes('验证')) {
        throw new Error('Verification required');
    }

    // Try to extract file list
    const listMatch = html.match(/"list"\s*:\s*(\[[\s\S]*?\])(?=\s*[,}])/);

    if (listMatch) {
        try {
            const list = JSON.parse(listMatch[1]);
            const files = list.map(f => ({
                fs_id: String(f.fs_id),
                filename: f.server_filename || f.filename,
                size: f.size,
                sizeFormatted: formatSize(f.size),
                dlink: f.dlink || null,
                thumb: f.thumbs?.url3 || null
            }));

            if (files.length > 0) {
                return {
                    success: true,
                    data: { files },
                    source: 'scrape'
                };
            }
        } catch (e) {
            throw new Error('Parse error');
        }
    }

    // Try single file
    const fnMatch = html.match(/"server_filename"\s*:\s*"([^"]+)"/);
    const fsMatch = html.match(/"fs_id"\s*:\s*(\d+)/);
    const sizeMatch = html.match(/"size"\s*:\s*(\d+)/);
    const dlinkMatch = html.match(/"dlink"\s*:\s*"([^"]+)"/);

    if (fnMatch && fsMatch) {
        return {
            success: true,
            data: {
                files: [{
                    fs_id: fsMatch[1],
                    filename: fnMatch[1].replace(/\\/g, ''),
                    size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                    sizeFormatted: sizeMatch ? formatSize(parseInt(sizeMatch[1])) : 'Unknown',
                    dlink: dlinkMatch ? dlinkMatch[1].replace(/\\/g, '') : null
                }]
            },
            source: 'scrape'
        };
    }

    throw new Error('Could not extract data from page');
}

function extractSurl(url) {
    const match = url.match(/\/s\/(1?[a-zA-Z0-9_-]+)/i) ||
                  url.match(/surl=(1?[a-zA-Z0-9_-]+)/i);
    if (match) return match[1];
    throw new Error('Invalid TeraBox URL');
}

function getBaseUrl(url) {
    if (url.includes('1024tera.com')) return 'https://www.1024tera.com';
    if (url.includes('1024terabox.com')) return 'https://www.1024terabox.com';
    if (url.includes('4funbox.com')) return 'https://www.4funbox.com';
    if (url.includes('teraboxapp.com')) return 'https://www.teraboxapp.com';
    return 'https://www.terabox.com';
}

function formatSize(bytes) {
    if (!bytes) return 'Unknown';
    const b = parseInt(bytes);
    if (isNaN(b)) return String(bytes);
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, s = b;
    while (s >= 1024 && i < 4) { s /= 1024; i++; }
    return s.toFixed(2) + ' ' + u[i];
}

app.listen(PORT, () => {
    console.log(`
🚀 TeraBox API running on port ${PORT}

Endpoints:
  GET /                     - API info
  GET /api/get?url=<link>   - Get file info
  GET /health               - Health check
    `);
});
