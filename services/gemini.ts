// File: services/gemini.ts
import { GoogleGenAI, Type } from "@google/genai";
import { OutlineItem, Theme } from "../types";
import {
  FLASH_PREVIEW_MODEL,
  FLASH_LITE_MODEL,
  FLASH_OLD_MODEL,
  POLLINATIONS_PUBLIC_API_KEY,
} from "../constants";
import * as Prompts from "../prompts";

const cleanJsonString = (text: string) => {
  let clean = text.trim();
  if (clean.startsWith("```json")) {
    clean = clean.replace(/^```json/, "").replace(/```$/, "");
  } else if (clean.startsWith("```")) {
    clean = clean.replace(/^```/, "").replace(/```$/, "");
  }
  return clean;
};

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    (async () => {
      const apiKey = process.env.GEMINI_API_KEY;
      this.ai = new GoogleGenAI({ apiKey });
    })();
  }

  /**
   * A private helper to wrap API calls with a retry mechanism.
   * Retries up to `maxRetries` times with linear backoff.
   * Aborts immediately on 429 (rate limit) errors.
   */
  private async _withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (
          (error.message && error.message.includes("429")) ||
          error.code == 429
        ) {
          console.error("Rate limit exceeded (429). Aborting retries.");
          throw error;
        }
        console.warn(
          `Attempt ${i + 1} of ${maxRetries} failed. Retrying in ${i + 1}s...`,
          error
        );
        await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
      }
    }
    throw new Error(
      `AI service failed after ${maxRetries} attempts. Last error: ${lastError?.message}`
    );
  }

  // --- STAGE 1: RESEARCH & OUTLINE ---

  async createOutline(
    mode: "prompt" | "text" | "document",
    inputData: string,
    noOfSlides: number = 10
  ): Promise<{ outline: OutlineItem[]; notes: string }> {
    // UPDATED: Split System Instruction vs User Content
    const userPrompt = Prompts.getOutlineUserPrompt(
      mode,
      inputData,
      noOfSlides
    );

    // We add the JSON structure here just to reinforce it in the user prompt end,
    // or keep it in system prompt. Based on experience, redundancy for formatting in user prompt helps.
    const finalUserContent = `${userPrompt}\n${Prompts.OUTLINE_JSON_STRUCTURE}`;

    let contents: any = [{ text: finalUserContent }];

    if (mode == "document") {
      contents.push({
        inlineData: {
          mimeType: "application/pdf",
          data: inputData,
        },
      });
    }

    try {
      const response = await this._withRetry(() =>
        this.ai.models.generateContent({
          model: FLASH_LITE_MODEL,
          contents: contents,
          config: {
            systemInstruction: Prompts.OUTLINE_SYSTEM_INSTRUCTION, // Moved heavy Prompt here
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                outline: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      points: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ["title", "points"],
                  },
                },
                notes: { type: Type.STRING },
              },
              required: ["outline", "notes"],
            },
          },
        })
      );

      const text = response.text || "{}";
      const data = JSON.parse(cleanJsonString(text));
      if (!data.outline) {
        throw new Error("AI returned an invalid outline structure.");
      }
      console.log("Notes: ",data?.notes)
      return {
        outline: data.outline.map((item: any, i: number) => ({
          ...item,
          id: item.id || `slide-${i}`,
        })),
        notes: data?.notes || "",
      };
    } catch (error) {
      console.error("Failed to create outline:", error);
      throw new Error(error);
    }
  }

  // --- STAGE 1.5: REMIX OUTLINE ---
  // (refineOutline remains mostly the same, usually refinement prompts are short enough to be passed in content,
  // but you can split it if you wish. Leaving it as is for minimal regression risk on small features)
  async refineOutline(
    currentOutline: OutlineItem[],
    instruction: string
  ): Promise<{ outline: OutlineItem[]; notes: string }> {
    const prompt = Prompts.getRefineOutlinePrompt(currentOutline, instruction);

    try {
      const response = await this._withRetry(() =>
        this.ai.models.generateContent({
          model: FLASH_LITE_MODEL,
          contents: prompt,
          config: {
            systemInstruction: Prompts.OUTLINE_SYSTEM_INSTRUCTION, // Moved heavy Prompt here
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                outline: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      points: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ["title", "points"],
                  },
                },
              },
              required: ["outline"],
            },
          },
        })
      );
      const data = JSON.parse(cleanJsonString(response.text || "{}"));
      if (!data.outline) {
        throw new Error("AI returned an invalid outline structure.");
      }
      return data.outline;
    } catch (error) {
      console.error("Failed to refine outline:", error);
      throw new Error(error);
    }
  }

  // --- STAGE 1.8: AUTO THEME GENERATION ---

  async generateAutoTheme(
    title: string,
    outline: OutlineItem[]
  ): Promise<Theme> {
    const prompt = Prompts.getAutoThemePrompt(title, outline);

    try {
      const response = await this._withRetry(() =>
        this.ai.models.generateContent({
          model: FLASH_LITE_MODEL, // Lite is perfect for this, fast & creative
          contents: prompt,
          config: {
            systemInstruction: Prompts.AUTO_THEME_SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                prompt: { type: Type.STRING },
                colors: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                html: { type: Type.STRING },
              },
              required: ["name", "prompt", "colors"],
            },
          },
        })
      );

      const text = response.text || "{}";
      const data = JSON.parse(cleanJsonString(text));

      if (!data.name || !data.colors) {
        throw new Error("Invalid theme generated.");
      }

      // Construct a Theme object compatible with your app
      return {
        id: "auto-theme",
        name: data.name,
        colors: data.colors,
        prompt: data.prompt, // This description will guide the generation later
        description: "AI Generated Custom Theme",
        html: data.html,
      };
    } catch (error) {
      console.error("Failed to generate auto theme:", error);
      // Fallback to a safe default if AI fails
      return {
        id: "auto-theme",
        name: "Modern Minimal",
        colors: ["#ffffff", "#000000", "#3b82f6", "#f3f4f6", "#9ca3af"],
        prompt: "Clean, modern design with ample whitespace.",
        description: "Inter",
      };
    }
  }

  // (generateColorPalettes remains unchanged)
  async generateColorPalettes(prompt: string): Promise<string[][]> {
    const aiPrompt = Prompts.getColorPalettePrompt(prompt);
    try {
      const response = await this._withRetry(() =>
        this.ai.models.generateContent({
          model: FLASH_LITE_MODEL,
          contents: aiPrompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                palettes: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
              },
              required: ["palettes"],
            },
          },
        })
      );
      const text = response.text || "{}";
      const data = JSON.parse(cleanJsonString(text));
      if (!data.palettes || !Array.isArray(data.palettes)) {
        throw new Error("AI returned an invalid palette structure.");
      }
      return data.palettes;
    } catch (error) {
      console.error("Failed to generate color palettes:", error);
      throw new Error(error);
    }
  }

  // --- STAGE 2: SLIDE GENERATION ---

  async *generatePresentationStream(
    title: string,
    outline: OutlineItem[],
    notes: string,
    theme: Theme,
    mode: "concise" | "balanced" | "theory",
    customizationPrompt: string
  ): AsyncGenerator<{ text: string; isComplete: boolean }> {
    // 1. Initialize the Chat Session
    // We pass the System Instruction and Schema here so it applies to EVERY interaction in the chat.
    const chat = this.ai.chats.create({
      model: FLASH_PREVIEW_MODEL,
      config: {
        systemInstruction: Prompts.PRESENTATION_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        temperature: 0.87,
        topP: 0.9,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            slides: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING },
                },
                required: ["title", "content"],
              },
            },
          },
          required: ["slides"],
        },
      },
    });

    const BATCH_SIZE = 4;

    // 2. Format the Full Outline for Context (so the model understands the full narrative)
    const formattedFullOutline = outline
      .map(
        (s, i) => `Slide ${i + 1}: ${s.title} (Focus: ${s.points.join(", ")})`
      )
      .join("\n");

    // 3. Iterate through the outline in chunks
    for (let i = 0; i < outline.length; i += BATCH_SIZE) {
      const startSlide = i + 1;
      const endSlide = Math.min(i + BATCH_SIZE, outline.length);

      // Calculate if this is the final batch in the loop
      const isLastBatch = endSlide >= outline.length;

      // Select only the outline items for this specific batch
      const batchOutlineItems = outline.slice(i, i + BATCH_SIZE);
      const batchOutlineText = batchOutlineItems
        .map((s, idx) => `Slide ${i + idx + 1}: ${s.title}`)
        .join("\n");

      let message = "";

      // 4. Construct the Prompt
      if (i === 0) {
        // FIRST REQUEST: Send context + First Batch
        message = `
          ${Prompts.getPresentationUserPrompt(
            title,
            theme,
            mode,
            customizationPrompt,
            formattedFullOutline,
            notes
          )}
          
          <CURRENT_TASK>
            Generate **Slides ${startSlide} to ${endSlide}**.
            Refer to the specific points for these slides in the outline above.
            Ensure the design establishes the visual identity for the deck.
          </CURRENT_TASK>
        `;
      } else {
        // SUBSEQUENT REQUESTS: "Continue" logic
        message = `
          Great. Now generate **Slides ${startSlide} to ${endSlide}**.
          
          <BATCH_CONTEXT>
             Current Batch Outline:
             ${batchOutlineText}
          </BATCH_CONTEXT>

          <CONSTRAINT>
            Maintain strict visual consistency with the previous slides (colors, fonts, layout style).
            Return valid JSON for these specific slides.
          </CONSTRAINT>
        `;
      }

      // 5. Send Message Stream
      try {
        const responseStream = await this._withRetry(() =>
          chat.sendMessageStream({
            message: message,
            // Config is inherited from chat creation, but we can override if needed
          })
        );

        // 6. Yield the chunks to the frontend
        for await (const chunk of responseStream) {
          if (chunk.text) {
            // NOTE: The frontend receives multiple JSON objects (one per batch).
            yield { 
              text: chunk.text, 
              isComplete: isLastBatch 
            };
          }
        }
      } catch (error) {
        console.error(
          `Error generating batch ${startSlide}-${endSlide}:`,
          error
        );
        // Optional: Decide if you want to throw or continue.
        // Throwing is usually safer so the user knows it failed.
        throw error;
      }
    }
  }

  // --- TOKENIZATION HELPERS ---

  private replaceImagesWithPlaceholders(html: string): {
    cleanedHtml: string;
    imageMap: Map<string, string>;
  } {
    const imageMap = new Map<string, string>();
    let imgCounter = 0;

    const cleanedHtml = html.replace(
      /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
      (match, src: string) => {
        if (!src.startsWith("https")) {
          const placeholder = `https://placeholder.img/id-${imgCounter++}`;
          imageMap.set(placeholder, src);
          return match.replace(src, placeholder);
        } else {
          return match;
        }
      }
    );

    return { cleanedHtml, imageMap };
  }

  private restoreImages(html: string, imageMap: Map<string, string>): string {
    function transformPollinationsURLs(input: string) {
      const urlRegex =
        /https?:\/\/gen\.pollinations\.ai\/image\/([^\\"\s>]+)/gi;
      return input.replaceAll(urlRegex, (full, raw) => {
        let desc = raw.replace(/_/g, " ");
        desc = decodeURIComponent(desc);
        const encoded = encodeURIComponent(desc);
        return `https://gen.pollinations.ai/image/${encoded}?model=flux&key=${POLLINATIONS_PUBLIC_API_KEY}`;
      });
    }

    function convertQuickChartTags(htmlString) {
      const quickchartTagRegex = /<quickchart([\s\S]+?)>/g;
      return htmlString.replace(
        quickchartTagRegex,
        (match, attributesString) => {
          const cleanedAttributesString = attributesString
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'");
          const attributeRegex = /([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
          const attributes: Record<string, string> = {};
          let attrMatch;
          while (
            (attrMatch = attributeRegex.exec(cleanedAttributesString)) !== null
          ) {
            attributes[attrMatch[1]] = attrMatch[3];
          }
          if (!attributes.config) {
            console.error(
              "QuickChart tag found without a parsable 'config' attribute. Original tag:",
              match
            );
            return match;
          }
          const encodedConfig = encodeURIComponent(
            attributes.config.replaceAll("'", '"')
          );
          const chartUrl = `https://quickchart.io/chart?c=${encodedConfig}`;
          let imgTag = `<img src=${chartUrl}`;
          for (const key in attributes) {
            if (key !== "config") {
              imgTag += ` ${key}=${attributes[key]}`;
            }
          }
          imgTag += ">";
          return imgTag;
        }
      );
    }

    let restoredHtml = convertQuickChartTags(transformPollinationsURLs(html));

    for (const [placeholder, originalSrc] of imageMap.entries()) {
      const escapedPlaceholder = placeholder.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      const regex = new RegExp(escapedPlaceholder, "g");
      restoredHtml = restoredHtml.replace(regex, originalSrc);
    }

    return restoredHtml;
  }

  async editContent(
    currentContent: string,
    instruction: string,
    context: "slide" | "element" = "slide"
  ): Promise<string> {
    // 1. Tokenize Images
    const { cleanedHtml, imageMap } =
      this.replaceImagesWithPlaceholders(currentContent);

    const prompt = Prompts.getEditContentPrompt(
      cleanedHtml,
      instruction,
      context
    );

    try {
      const response = await this._withRetry(() =>
        this.ai.models.generateContent({
          model: FLASH_PREVIEW_MODEL,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: { html: { type: Type.STRING } },
              required: ["html"],
            },
          },
        })
      );
      const text = response.text || `{ "html": "" }`;
      const data = JSON.parse(cleanJsonString(text));
      let newHtml = data.html || currentContent;
      // 2. Detokenize
      newHtml = this.restoreImages(newHtml, imageMap);
      return newHtml;
    } catch (error) {
      console.error("Failed to edit content:", error);
      throw new Error(error);
    }
  }

  async restyleDeck(
    slides: { id: string; title: string; content: string }[],
    oldTheme: Theme,
    newTheme: Theme
  ): Promise<{ id: string; title: string; content: string }[]> {
    // 1. Tokenize Images globally across ALL slides
    // We do this once upfront so IDs remain unique across the whole deck
    const globalImageMap = new Map<string, string>();
    let globalImgCounter = 0;

    const slidesWithPlaceholders = slides.map((slide) => {
      const cleaned = slide.content.replace(
        /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
        (match, src) => {
          const placeholder = `https://placeholder.img/global-id-${globalImgCounter++}`;
          globalImageMap.set(placeholder, src);
          return match.replace(src, placeholder);
        }
      );
      return { ...slide, content: cleaned };
    });

    // 2. Initialize Chat Session for Restyling
    const chat = this.ai.chats.create({
      model: FLASH_PREVIEW_MODEL,
      config: {
        systemInstruction: Prompts.RESTYLE_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            slides: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING },
                },
                required: ["title", "content"],
              },
            },
          },
          required: ["slides"],
        },
      },
    });

    const BATCH_SIZE = 4;
    const restyledSlidesAccumulator: { title: string; content: string }[] = [];

    // 3. Process in Batches
    for (let i = 0; i < slidesWithPlaceholders.length; i += BATCH_SIZE) {
      const batch = slidesWithPlaceholders.slice(i, i + BATCH_SIZE);

      let message = "";
      if (i === 0) {
        message = Prompts.getRestyleFirstBatchPrompt(newTheme, oldTheme, batch);
      } else {
        message = Prompts.getRestyleNextBatchPrompt(batch);
      }

      try {
        const result = await this._withRetry(() =>
          chat.sendMessage({ message })
        );
        const text = result.text;
        const data = JSON.parse(cleanJsonString(text));

        if (data.slides && Array.isArray(data.slides)) {
          restyledSlidesAccumulator.push(...data.slides);
        } else {
          console.warn(`Batch ${i} returned invalid structure`, text);
          // Fallback: push original content if AI fails for a batch
          restyledSlidesAccumulator.push(
            ...batch.map((s) => ({ title: s.title, content: s.content }))
          );
        }
      } catch (error) {
        console.error(`Failed to restyle batch starting at index ${i}:`, error);
        // Fallback on error
        restyledSlidesAccumulator.push(
          ...batch.map((s) => ({ title: s.title, content: s.content }))
        );
      }
    }

    // 4. Detokenize (Restore Images) & Merge
    // We assume the AI returned slides in the same order as input (1-to-1 mapping).
    const finalSlides = slides.map((originalSlide, i) => {
      const restyledSlide = restyledSlidesAccumulator[i];

      if (!restyledSlide) return originalSlide; // Should not happen if fallback logic works

      // Restore images using the Global Map
      const contentWithRestoredImages = this.restoreImages(
        restyledSlide.content,
        globalImageMap
      );

      return {
        ...originalSlide,
        title: restyledSlide.title, // Use AI's title (it might have fixed typography/case)
        content: contentWithRestoredImages,
      };
    });

    return finalSlides;
  }

  async refineText(
    text: string,
    action: "expand" | "condense" | "rewrite" | "tone"
  ): Promise<string> {
    const prompt = Prompts.getRefineTextPrompt(text, action);
    try {
      const response = await this._withRetry(() =>
        this.ai.models.generateContent({
          model: FLASH_OLD_MODEL,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: { text: { type: Type.STRING } },
              required: ["text"],
            },
          },
        })
      );
      const responseText = response.text || `{ "text": "" }`;
      const data = JSON.parse(cleanJsonString(responseText));
      return data.text || text;
    } catch (error) {
      console.error("Failed to refine text:", error);
      throw new Error(error);
    }
  }
}

export const geminiService = new GeminiService();
