export interface LinkMetadata {
  url: string;
  title: string;
  description: string;
  image?: string;
  domain: string;
}

export interface CuratedPostPayload {
  content: string;
  metadata: LinkMetadata;
}

/**
 * Extrae metadatos Open Graph directamente del HTML de una URL objetivo.
 */
export async function extractOpenGraph(url: string): Promise<LinkMetadata> {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname.replace(/^www\./, '');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Error al acceder a la URL: ${response.status}`);
    }

    const html = await response.text();

    const getMetaProperty = (property: string): string => {
      const match = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i')) ||
                    html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["']*, [^>]*property=["']${property}["']`, 'i')) ||
                    html.match(new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'));
      return match ? match[1].trim() : '';
    };

    let title = getMetaProperty('og:title') || getMetaProperty('twitter:title');
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : domain;
    }

    const description = getMetaProperty('og:description') || getMetaProperty('description') || getMetaProperty('twitter:description');
    const image = getMetaProperty('og:image') || getMetaProperty('twitter:image') || undefined;

    return {
      url,
      title,
      description,
      image,
      domain
    };
  } catch (error) {
    console.error(`Error extrayendo OG para ${url}:`, error);
    return {
      url,
      title: domain,
      description: '',
      domain
    };
  }
}

/**
 * Genera un comentario orgánico en 1-2 oraciones basado en la biografía del bot y la noticia hallada.
 */
export async function generateLinkComment(
  botBio: string,
  articleTitle: string,
  articleDescription: string,
  geminiApiKey: string
): Promise<string> {
  const prompt = `Eres una persona real en la red social ByKonet con el siguiente perfil/biografía:
"${botBio}"

Vas a compartir el siguiente enlace/noticia:
- Título: "${articleTitle}"
- Resumen: "${articleDescription}"

Escribe una opinión o comentario corto (máximo 1 a 2 oraciones) en primera persona, tono totalmente natural y orgánico, reaccionando o aportando sobre la noticia. NO uses hashtags excesivos ni sonar como un robot comercial. Escrito en español.`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 120 }
    })
  });

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return rawText.trim().replace(/^["']|["']$/g, '');
}
