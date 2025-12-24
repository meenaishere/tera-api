const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

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
        endpoints: {
            '/api/get?url=': 'Get file info and download link'
        },
        example: '/api/get?url=https://1024terabox.com/s/1xxxxx'
    });
});

// Main API
app.get('/api/get', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.json({ success: false, error: 'URL parameter required' });
    }

    console.log('Processing:', url);

    try {
        const result = await getTeraboxData(url);
        res.json(result);
    } catch (error) {
        console.error('Error:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// Alias endpoints
app.get('/api/list', (req, res) => {
    req.url = '/api/get' + req.url.slice(9);
    app._router.handle(req, res);
});

async function getTeraboxData(shareUrl) {
    // Try multiple working APIs
    const apis = [
        tryApi1,
        tryApi2,
        tryApi3,
        tryApi4,
        tryDirectScrape
    ];

    let lastError = 'All methods failed';

    for (const api of apis) {
        try {
            const result = await api(shareUrl);
            if (result && result.success) {
                return result;
            }
        } catch (e) {
            lastError = e.message;
            continue;
        }
    }

    return { success: false, error: lastError };
}

// API Method 1
async function tryApi1(url) {
    const apiUrl = `https://teraboxvideodownloader.nepcoderdevs.workers.dev/api/get-info?data=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl, { timeout: 15000 });
    const data = response.data;

    if (data && (data.file_name || data.resolutions)) {
        return {
            success: true,
            data: {
                filename: data.file_name,
                size: data.size,
                sizeFormatted: formatSize(data.size),
                thumb: data.thumb,
                downloadUrl: data.download_link || data.dlink,
                resolutions: data.resolutions || null
            },
            source: 'api1'
        };
    }
    throw new Error('No data from API 1');
}

// API Method 2
async function tryApi2(url) {
    const apiUrl = `https://terabox.udayscriptsx.workers.dev/api/get-info?data=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl, { timeout: 15000 });
    const data = response.data;

    if (data && (data.file_name || data.list)) {
        return {
            success: true,
            data: formatApiResponse(data),
            source: 'api2'
        };
    }
    throw new Error('No data from API 2');
}

// API Method 3
async function tryApi3(url) {
    const apiUrl = `https://teraboxdownloader.nepcoderdevs.workers.dev/api/get-info?data=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl, { timeout: 15000 });
    const data = response.data;

    if (data && (data.file_name || data.download_link)) {
        return {
            success: true,
            data: formatApiResponse(data),
            source: 'api3'
        };
    }
    throw new Error('No data from API 3');
}

// API Method 4
async function tryApi4(url) {
    const surl = extractSurl(url);
    const baseUrl = getBaseUrl(url);

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': baseUrl
    };

    // Get share info
    const infoRes = await axios.get(`${baseUrl}/api/shorturlinfo?shorturl=${surl}&root=1`, { headers, timeout: 10000 });

    if (infoRes.data.errno !== 0) {
        throw new Error('API Error: ' + infoRes.data.errno);
    }

    // Get file list
    const listRes = await axios.get(`${baseUrl}/share/list?shorturl=${surl}&dir=/&root=1&page=1&num=100`, { headers, timeout: 10000 });

    if (listRes.data.errno !== 0) {
        throw new Error('List Error: ' + listRes.data.errno);
    }

    const files = (listRes.data.list || []).map(f => ({
        fs_id: String(f.fs_id),
        filename: f.server_filename,
        size: f.size,
        sizeFormatted: formatSize(f.size),
        isDir: f.isdir === 1,
        dlink: f.dlink,
        thumb: f.thumbs?.url3 || null
    }));

    return {
        success: true,
        data: {
            files,
            shareInfo: {
                shareid: infoRes.data.shareid,
                uk: infoRes.data.uk,
                sign: infoRes.data.sign,
                timestamp: infoRes.data.timestamp
            }
        },
        source: 'direct'
    };
}

// Direct page scrape
async function tryDirectScrape(url) {
    const response = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml'
        },
        timeout: 15000
    });

    const html = response.data;

    // Extract file data from HTML
    const listMatch = html.match(/"list"\s*:\s*(\[[\s\S]*?\])(?=\s*[,}])/);
    if (listMatch) {
        try {
            const list = JSON.parse(listMatch[1]);
            const files = list.map(f => ({
                fs_id: String(f.fs_id),
                filename: f.server_filename,
                size: f.size,
                sizeFormatted: formatSize(f.size),
                dlink: f.dlink,
                thumb: f.thumbs?.url3 || null
            }));

            return {
                success: true,
                data: { files },
                source: 'scrape'
            };
        } catch (e) {}
    }

    throw new Error('Could not parse page');
}

function formatApiResponse(data) {
    if (data.file_name) {
        return {
            filename: data.file_name,
            size: data.size || data.sizebytes,
            sizeFormatted: formatSize(data.size || data.sizebytes),
            thumb: data.thumb,
            downloadUrl: data.download_link || data.dlink,
            resolutions: data.resolutions || null
        };
    }

    if (data.list) {
        return {
            files: data.list.map(f => ({
                fs_id: String(f.fs_id),
                filename: f.server_filename || f.filename,
                size: f.size,
                sizeFormatted: formatSize(f.size),
                dlink: f.dlink,
                thumb: f.thumbs?.url3 || null
            }))
        };
    }

    return data;
}

function extractSurl(url) {
    const match = url.match(/\/s\/(1?[a-zA-Z0-9_-]+)/i);
    if (match) return match[1];
    throw new Error('Invalid URL');
}

function getBaseUrl(url) {
    if (url.includes('1024tera.com')) return 'https://www.1024tera.com';
    if (url.includes('1024terabox.com')) return 'https://www.1024terabox.com';
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
    console.log(`🚀 TeraBox API running on port ${PORT}`);
});
