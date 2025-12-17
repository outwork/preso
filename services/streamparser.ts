// File: services/streamParser.ts

/**
 * Parses a streaming string from the AI to extract complete slides 
 * and the current HTML chunk in progress.
 * 
 * @param stream The full string buffer from the AI
 * @param isStreamComplete Boolean flag if the generation process is fully finished
 */
export const parseLiveStream = (
  stream: string,
  isStreamComplete: boolean = false
): {
  completeSlides: { title: string; content: string }[];
  inProgressHtml: string;
} => {
  const completeSlides: { title: string; content: string }[] = [];
  
  // 1. ROBUST CLEANING: 
  // We must remove markdown tags that appear anywhere, not just at the start.
  // The AI might output: "{...} ```json {...}" so we replace all occurrences.
  let cleanStream = stream
    .replace(/```json/g, "") // Remove all ```json
    .replace(/```/g, "")     // Remove all remaining ```
    .trim();

  // --- PHASE 1: Extract Fully Completed Batches ---
  
  let braceCount = 0;
  let inString = false;
  let currentObjectStartIndex = -1;
  let lastValidBatchEndIndex = 0;

  for (let i = 0; i < cleanStream.length; i++) {
    const char = cleanStream[i];
    
    // Skip escaped characters
    if (char === "\\" && i + 1 < cleanStream.length) { 
      i++; 
      continue; 
    }
    
    if (char === '"') { inString = !inString; }

    if (!inString) {
      if (char === "{") {
        if (braceCount === 0) currentObjectStartIndex = i;
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        // Check for root level object closure
        if (braceCount === 0 && currentObjectStartIndex !== -1) {
          const batchStr = cleanStream.substring(currentObjectStartIndex, i + 1);
          try {
            const batch = JSON.parse(batchStr);
            if (batch && Array.isArray(batch.slides)) {
              completeSlides.push(...batch.slides);
            }
            lastValidBatchEndIndex = i + 1;
          } catch (e) { 
            // If parse fails, it might be a partial fragment or hallucination
          }
          currentObjectStartIndex = -1;
        }
      }
    }
  }

  // --- PHASE 2: Peek Inside the "Open" (Incomplete) Batch ---
  
  const remainingStream = cleanStream.substring(lastValidBatchEndIndex);
  let inProgressHtml = "";
  
  // Find where the "slides" array starts in this open batch
  const slidesArrayMatch = remainingStream.match(/"slides"\s*:\s*\[/);
  
  if (slidesArrayMatch && slidesArrayMatch.index !== undefined) {
    const slidesArrayStart = slidesArrayMatch.index + slidesArrayMatch[0].length;
    const slidesString = remainingStream.substring(slidesArrayStart);

    let slideBraceCount = 0;
    let slideStartIndex = -1;
    let slideInString = false;
    let lastParsedSlideEnd = 0; 

    for (let j = 0; j < slidesString.length; j++) {
      const char = slidesString[j];
      if (char === "\\") { j++; continue; }
      if (char === '"') { slideInString = !slideInString; }

      if (!slideInString) {
        if (char === "{") {
          if (slideBraceCount === 0) slideStartIndex = j;
          slideBraceCount++;
        } else if (char === "}") {
          slideBraceCount--;
          if (slideBraceCount === 0 && slideStartIndex !== -1) {
            // Found a slide object candidate
            const potentialSlideStr = slidesString.substring(slideStartIndex, j + 1);
            try {
              const slide = JSON.parse(potentialSlideStr);
              if (slide.title && slide.content) {
                // Deduplication check
                const exists = completeSlides.some(s => s.title === slide.title);
                if (!exists) completeSlides.push(slide);
                lastParsedSlideEnd = j + 1;
              }
            } catch (e) { }
            slideStartIndex = -1;
          }
        }
      }
    }

    // --- PHASE 3: Extract "In Progress" HTML ---
    
    // Only extract HTML if we aren't completely done with the stream.
    // If isStreamComplete is true, we assume all valid slides are parsed.
    if (!isStreamComplete) {
      const activeSlidePart = slidesString.substring(lastParsedSlideEnd);
      const contentMatch = activeSlidePart.match(/"content"\s*:\s*"/);
      
      if (contentMatch && contentMatch.index !== undefined) {
        let partialHtml = activeSlidePart.substring(contentMatch.index + contentMatch[0].length);
        
        partialHtml = partialHtml
          .replace(/\\"/g, '"')
          .replace(/\\n/g, "\n")
          .replace(/\\\\/g, "\\");

        const firstTagEnd = partialHtml.indexOf(">");
        if (firstTagEnd > -1) {
          // If we don't find a closing div, append one for preview safety
          if(partialHtml.lastIndexOf("</div>") === -1) {
              inProgressHtml = partialHtml + "</div>";
          } else {
              inProgressHtml = partialHtml;
          }
        }
      }
    }
  }

  return { completeSlides, inProgressHtml };
};

export const transformPollinationsURLs = (input: string, apiKey: string) => {
    const urlRegex = /https?:\/\/gen\.pollinations\.ai\/image\/([^\\"\s>]+)/gi;
  
    return input.replaceAll(urlRegex, (full, raw) => {
      let desc = raw.replace(/_/g, " ");
      desc = decodeURIComponent(desc);
      const encoded = encodeURIComponent(desc);
  
      return `https://gen.pollinations.ai/image/${encoded}?model=flux&key=${apiKey}`;
    });
  }
  
  export const convertQuickChartTags = (htmlString: string) => {
    const quickchartTagRegex = /<quickchart([\s\S]+?)>/g;
  
    return htmlString.replace(quickchartTagRegex, (match, attributesString) => {
      const cleanedAttributesString = attributesString
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
  
      const attributeRegex = /([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
      const attributes: Record<string, string> = {};
      let attrMatch;
  
      while ((attrMatch = attributeRegex.exec(cleanedAttributesString)) !== null) {
        attributes[attrMatch[1]] = attrMatch[3];
      }
  
      if (!attributes.config) return match;
  
      const encodedConfig = encodeURIComponent(
        attributes.config.replaceAll("'", '"')
      );
      const chartUrl = `https://quickchart.io/chart?c=${encodedConfig}`;
      let imgTag = `<img src="${chartUrl}"`;
  
      for (const key in attributes) {
        if (key !== "config") {
          const escapedValue = attributes[key].replace(/"/g, "&quot;");
          imgTag += ` ${key}="${escapedValue}"`;
        }
      }
  
      imgTag += ">";
      return imgTag;
    });
  }