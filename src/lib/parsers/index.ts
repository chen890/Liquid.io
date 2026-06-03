export interface ParsedDocument {
  text: string;
  pageCount?: number;
  metadata?: Record<string, string>;
}

export async function parseFile(file: File): Promise<ParsedDocument> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'pdf':
      return parsePDF(file);
    case 'docx':
    case 'doc':
      return parseDOCX(file);
    case 'xlsx':
    case 'xls':
      return parseXLSX(file);
    case 'csv':
      return parseCSV(file);
    case 'xml':
      return parseXML(file);
    case 'html':
    case 'htm':
      return parseHTML(file);
    case 'txt':
    default:
      return parseTXT(file);
  }
}

async function parsePDF(file: File): Promise<ParsedDocument> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: unknown) => {
        const textItem = item as { str?: string };
        return textItem.str ?? '';
      })
      .join(' ');
    pages.push(pageText);
  }

  return { text: pages.join('\n\n--- PAGE BREAK ---\n\n'), pageCount: pdf.numPages };
}

async function parseDOCX(file: File): Promise<ParsedDocument> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return { text: result.value };
}

async function parseXLSX(file: File): Promise<ParsedDocument> {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    sheets.push(`=== Sheet: ${sheetName} ===\n${csv}`);
  }

  return { text: sheets.join('\n\n') };
}

async function parseCSV(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  return { text };
}

async function parseXML(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  // Strip XML tags and normalize whitespace for better LLM processing
  const stripped = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text: `=== RAW XML ===\n${text}\n\n=== EXTRACTED TEXT ===\n${stripped}` };
}

async function parseHTML(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  const div = document.createElement('div');
  div.innerHTML = text;
  const extracted = div.textContent ?? div.innerText ?? '';
  return { text: extracted.replace(/\s+/g, ' ').trim() };
}

async function parseTXT(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  return { text };
}
