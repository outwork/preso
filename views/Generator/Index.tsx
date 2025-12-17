import React, { useState, useEffect } from "react";
import { CheckCircle } from "lucide-react";
import { UpgradeModal } from "../../components/UpgradeModal";
import { THEMES } from "../../themes";
import { geminiService } from "../../services/gemini";
import { readFileContent } from "../../services/fileParser";
import { saveDeck } from "../../services/db";
import { Deck, OutlineItem, InputMode, Theme } from "../../types";
import { POLLINATIONS_PUBLIC_API_KEY } from "../../constants";
import { parseLiveStream, transformPollinationsURLs, convertQuickChartTags } from "../../services/streamparser";

import { StepSelection } from "./StepSelection";
import { StepInput } from "./StepInput";
import { StepProcessing } from "./StepProcessing";
import { StepOutline } from "./StepOutline";
import { StepTheme } from "./StepTheme";
import { StepGeneration } from "./StepGeneration";

interface GeneratorProps {
  onDeckCreated: (deckId: string) => void;
  onCancel: () => void;
}

export const Generator: React.FC<GeneratorProps> = ({ onDeckCreated, onCancel }) => {
  // Steps
  const [step, setStep] = useState<"type" | "input" | "processing_outline" | "edit_outline" | "theme_selection" | "generating_slides">("type");
  
  // Data State
  const [inputMode, setInputMode] = useState<InputMode>("prompt");
  const [inputText, setInputText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [numSlides, setNumSlides] = useState(8);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [notes, setNotes] = useState<string>("");
  
  // Theme State
  const [displayThemes, setDisplayThemes] = useState<Theme[]>(THEMES);
  const [selectedTheme, setSelectedTheme] = useState<Theme>(THEMES[0]);
  const [selectedMode, setSelectedMode] = useState<"concise" | "balanced" | "theory">("balanced");
  const [advancedInstructions, setAdvancedInstructions] = useState("");

  // Generation State
  const [generatedSlides, setGeneratedSlides] = useState<{ title: string; content: string }[]>([]);
  const [inProgressSlideHtml, setInProgressSlideHtml] = useState("");

  // Rate Limiting / UX
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const handleApiError = (error: any) => {
    console.error("Handle API Error:", error);
    if (error.message && error.message.includes("429")) {
      setIsRateLimitModalOpen(true);
      return true;
    }
    return false;
  };

  const handleGenerateOutline = async () => {
    setStep("processing_outline");
    let textData = inputText;
    if (inputMode === "document" && uploadedFile) {
      try {
        textData = await readFileContent(uploadedFile);
      } catch (e) {
        showToast("Error reading file.");
        setStep("input");
        return;
      }
    }
    if (!textData) return;
    try {
      const generatedOutline = await geminiService.createOutline(inputMode, textData, numSlides);
      setOutline(generatedOutline.outline.slice(0, numSlides));
      setNotes(generatedOutline.notes);
      setStep("edit_outline");
    } catch (e: any) {
      if (!handleApiError(e)) showToast("Failed to generate outline.");
      setStep("input");
    }
  };

// Inside Generator component in Index.tsx

const handleAutoTheme = async () => {
  setStep("processing_outline"); // Re-use processing UI or create a 'generating_theme' state
  showToast("Analyzing content for the perfect look...");
  
  try {
    const title = outline[0]?.title || "Presentation";
    
    // 1. Call the AI
    const customTheme = await geminiService.generateAutoTheme(title, outline);
    
    // 2. Update the Display Themes list
    // We add the new AI theme to the FRONT of the list
    setDisplayThemes([customTheme, ...THEMES]);
    
    // 3. Automatically select it
    setSelectedTheme(customTheme);
    
    // 4. Move to Theme Selection step to let user confirm (or generate immediately)
    setStep("theme_selection");
    showToast(`Created theme: ${customTheme.name}`);
    
  } catch (e) {
    console.error(e);
    showToast("Could not auto-generate theme.");
    setStep("theme_selection");
  }
};

const handleFinalGeneration = async () => {
    setStep("generating_slides");
    setGeneratedSlides([]);
    setInProgressSlideHtml("");
    
    let fullResponse = "";
    // Keep a local reference to the latest slides to avoid React state closure staleness
    let finalCompleteSlides: { title: string; content: string }[] = [];

    try {
      const title = outline[0]?.title.split(/:\s*/).slice(-1)[0] || "Untitled Presentation";
      
      const stream = geminiService.generatePresentationStream(
        title, outline, notes, selectedTheme, selectedMode, advancedInstructions
      );

      for await (const chunk of stream) {
        fullResponse += chunk.text;
        
        // Parse the stream as it arrives (this handles the concatenated JSONs)
        const { completeSlides, inProgressHtml } = parseLiveStream(fullResponse, chunk.isComplete);
        
        // Update UI
        setGeneratedSlides(completeSlides);
        setInProgressSlideHtml(inProgressHtml);
        
        // Update local reference for the final save step
        finalCompleteSlides = completeSlides;
      }

      // --- FIX STARTS HERE ---
      
      // We do NOT parse 'fullResponse' again using JSON.parse().
      // Instead, we take the slides we successfully parsed during streaming
      // and apply the final transformations (Pollinations/Charts) to each slide.
      
      const finalSlidesWithTransforms = finalCompleteSlides.map(slide => {
        let content = slide.content;
        
        // 1. Transform Pollinations URLs (add API key)
        content = transformPollinationsURLs(content, POLLINATIONS_PUBLIC_API_KEY || "");
        
        // 2. Convert <quickchart> tags to <img>
        content = convertQuickChartTags(content);
        
        return {
          ...slide,
          content
        };
      });

      const newDeck: Deck = {
        id: crypto.randomUUID(),
        title: title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        slides: finalSlidesWithTransforms.map((s) => ({
          id: crypto.randomUUID(),
          title: s.title,
          content: s.content,
        })),
        theme: selectedTheme.id,
      };

      await saveDeck(newDeck);
      onDeckCreated(newDeck.id);
      
    } catch (e: any) {
      if (!handleApiError(e)) showToast("Error generating presentation.");
      // If it fails, we go back to theme selection
      setStep("theme_selection");
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full py-8 px-6 mt-10 font-sans min-h-[calc(100vh-100px)] flex flex-col">
      <UpgradeModal
        isOpen={isRateLimitModalOpen}
        onClose={() => setIsRateLimitModalOpen(false)}
      />

      {toast && (
        <div className="fixed top-24 right-6 z-[99999]">
          <div className="bg-slate-900 text-white text-sm font-medium px-4 py-3 rounded-lg shadow-2xl animate-in fade-in slide-in-from-top flex items-center gap-2">
            <CheckCircle className="text-green-400" size={16} /> {toast}
          </div>
        </div>
      )}

      {step === "type" && (
        <StepSelection 
          onCancel={onCancel} 
          onSelect={(mode) => { setInputMode(mode); setStep("input"); }} 
        />
      )}

      {step === "input" && (
        <StepInput 
          inputMode={inputMode}
          inputText={inputText}
          setInputText={setInputText}
          uploadedFile={uploadedFile}
          setUploadedFile={setUploadedFile}
          numSlides={numSlides}
          setNumSlides={setNumSlides}
          onBack={() => setStep("type")}
          onGenerate={handleGenerateOutline}
        />
      )}

      {step === "processing_outline" && <StepProcessing />}

      {step === "edit_outline" && (
        <StepOutline
          outline={outline}
          setOutline={setOutline}
          setNotes={setNotes}
          onNext={async () => {  await handleAutoTheme(); setStep("theme_selection")}}
          handleApiError={handleApiError}
          showToast={showToast}
        />
      )}

      {step === "theme_selection" && (
        <StepTheme
          onBack={() => setStep("edit_outline")}
          onGenerate={handleFinalGeneration}
          selectedMode={selectedMode}
          setSelectedMode={setSelectedMode}
          displayThemes={displayThemes}
          setDisplayThemes={setDisplayThemes}
          selectedTheme={selectedTheme}
          setSelectedTheme={setSelectedTheme}
          advancedInstructions={advancedInstructions}
          setAdvancedInstructions={setAdvancedInstructions}
          handleApiError={handleApiError}
          showToast={showToast}
        />
      )}

      {step === "generating_slides" && (
        <StepGeneration
          outline={outline}
          generatedSlides={generatedSlides}
          inProgressSlideHtml={inProgressSlideHtml}
        />
      )}
    </div>
  );
};