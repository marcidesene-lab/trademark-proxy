export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { source, searchType, searchValue, niceClass } = req.query;

  if (!searchValue) {
    return res.status(400).json({ error: 'Parametrul searchValue lipseste' });
  }

  if (source === 'euipo') {
    return await searchEUIPO(searchType || 'name', searchValue, niceClass, res);
  } else {
    return res.status(400).json({ error: 'Source invalid. Folositi: euipo' });
  }
}

async function searchEUIPO(searchType, searchValue, niceClass, res) {
 const clientId = bee06de986c60d64e7567a2000fcec0e;
const clientSecret = 1d87c9597c1ad5e2817fdc628f698498;

  if (!clientId || !clientSecret) {
    return res.status(200).json({
      source: 'euipo', success: false,
      error: 'Cheile EUIPO nu sunt configurate', results: []
    });
  }

  try {
    const tokenRes = await fetch('https://auth.euipo.europa.eu/oidc/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'tmdsview:search',
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenRes.ok) {
      return res.status(200).json({
        source: 'euipo', success: false,
        error: 'Autentificare EUIPO esuata', results: []
      });
    }

    const { access_token } = await tokenRes.json();
    const params = new URLSearchParams({ pageSize: 10, pageNumber: 0 });

    if (searchType === 'name') {
      params.append('wordMarkSpecification', searchValue);
      params.append('criteria', 'CONTAINS');
    } else if (searchType === 'applicationNumber') {
      params.append('applicationNumber', searchValue.replace(/\s+/g, ''));
    } else if (searchType === 'registrationNumber') {
      params.append('registrationNumber', searchValue.replace(/\s+/g, ''));
    }

    if (niceClass) params.append('niceClass', niceClass);

    const searchRes = await fetch(
      `https://api.euipo.europa.eu/trademark-search/v1/trademarks?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!searchRes.ok) {
      return res.status(200).json({
        source: 'euipo', success: false,
        error: `EUIPO API status ${searchRes.status}`, results: []
      });
    }

    const data = await searchRes.json();
    const list = data.trademarks || data.content || data.results || [];
    const results = list.map(tm => ({
      name: tm.wordMarkSpecification || tm.trademarkName || tm.name || '',
      owner: tm.applicantName || tm.ownerName || '',
      status: mapStatus(tm.trademarkStatus || tm.status || ''),
      niceClass: (tm.niceClasses || []).join(', ') || tm.niceClass || '',
      applicationNumber: tm.applicationNumber || tm.id || '',
      registrationNumber: tm.registrationNumber || '',
      applicationDate: tm.filingDate || tm.applicationDate || '',
      registrationDate: tm.registrationDate || '',
      expiryDate: tm.expiryDate || '',
    }));

    return res.status(200).json({
      source: 'euipo', success: true,
      total: data.total || data.totalElements || results.length,
      results
    });

  } catch (err) {
    return res.status(200).json({
      source: 'euipo', success: false,
      error: 'Eroare conectare EUIPO: ' + err.message, results: []
    });
  }
}

function mapStatus(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('registered') || s.includes('activ') || s === 'r') return 'Activ';
  if (s.includes('expired') || s.includes('expirat') || s === 'e') return 'Expirat';
  if (s.includes('pending') || s.includes('filed') || s.includes('depus') || s === 'f') return 'Pendent';
  if (s.includes('refused') || s.includes('refuzat') || s === 'rf') return 'Refuzat';
  if (s.includes('withdrawn') || s.includes('retras')) return 'Retras';
  return raw || 'Necunoscut';
}
