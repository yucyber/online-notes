
export const isHtml = (text: string) => {
    if (!text) return false;
    const trimmed = text.trim();
    return trimmed.startsWith('<') && trimmed.endsWith('>');
}

export const htmlToMarkdown = (html: string) => {
    if (!html) return '';
    let text = html;

    // Replace paragraphs with double newlines
    text = text.replace(/<p>(.*?)<\/p>/gi, '$1\n\n');
    // Replace divs with newlines
    text = text.replace(/<div>(.*?)<\/div>/gi, '$1\n');
    // Replace breaks
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Headers
    text = text.replace(/<h([1-6])>(.*?)<\/h\1>/gi, (match, level, content) => {
        return '#'.repeat(Number(level)) + ' ' + content + '\n\n';
    });

    // Bold
    text = text.replace(/<(?:b|strong)>(.*?)<\/(?:b|strong)>/gi, '**$1**');

    // Italic
    text = text.replace(/<(?:i|em)>(.*?)<\/(?:i|em)>/gi, '*$1*');

    // Lists
    text = text.replace(/<li>(.*?)<\/li>/gi, '- $1\n');
    text = text.replace(/<\/?ul>/gi, '');
    text = text.replace(/<\/?ol>/gi, '');

    // Code blocks (pre/code)
    text = text.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n');
    text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');

    // Strip remaining tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode entities
    text = text.replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');

    // Fix multiple newlines
    text = text.replace(/\n{3,}/g, '\n\n');

    // Heuristic: Fix inline headers (e.g. "Intro ## Section") that lost newlines
    text = text.replace(/([^\n])\s+(#{1,6}\s)/g, '$1\n\n$2');

    // Heuristic: Fix inline list items (e.g. "Text - Item") - conservative check
    text = text.replace(/([^\n])\s+(-\s)/g, '$1\n$2');

    return text.trim();
}

export const markdownToHtml = (markdown: string) => {
    if (!markdown) return '';
    let html = markdown;

    // Escape HTML characters to prevent broken tags
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Headers
    html = html.replace(/^#{1,6}\s+(.*)$/gm, (match) => {
        const level = match.trim().indexOf(' ');
        const content = match.trim().substring(level + 1);
        return `<h${level}>${content}</h${level}>`;
    });

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // Lists (simple unordered)
    html = html.replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>');
    // Wrap consecutive lis in ul (simple heuristic)
    // This is tricky with regex, skipping for now, Tiptap might handle loose lis or we just accept it.

    // Paragraphs: Split by double newline and wrap if not already a tag
    const paragraphs = html.split(/\n\n+/);
    html = paragraphs.map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<h') || trimmed.startsWith('<li') || trimmed.startsWith('<pre')) return trimmed;
        return `<p>${trimmed}</p>`;
    }).join('');

    return html;
}
