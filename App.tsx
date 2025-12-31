// File: App.tsx
import React, { useState } from "react";
import { Layout } from "./components/Layout";
import { Dashboard } from "./views/Dashboard";
import { DeckView } from "./views/DeckView";
import { Button } from "./components/Button";
import { Deck } from "./types";
import { saveDeck } from "./services/db";
import { exportPresentation } from "./services/export";

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<
    "dashboard" | "deck"
  >("dashboard");
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [deckTitle, setDeckTitle] = useState("");

  const [isWorking, setIsWorking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Deck View State lifted to control header
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [isPresentationMode, setIsPresentationMode] = useState(false);

  const handleCreateNew = async () => {
    const deckId = crypto.randomUUID();
    const newDeck: Deck = {
      id: deckId,
      title: "Untitled Presentation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      theme: "default",
      slides: [
        {
          id: crypto.randomUUID(),
          title: "Slide 1",
          content:
            '<div class="absolute inset-0 bg-white flex items-center justify-center"><h1 class="text-7xl font-bold text-slate-900">TITLE</h1></div>',
        },
      ],
    };
    try {
      await saveDeck(newDeck);
      setActiveDeckId(deckId);
      setDeckTitle(newDeck.title);
      setDeck(newDeck);
      setCurrentView("deck");
    } catch (error) {
      console.error("Failed to create deck", error);
    }
  };

  const handleDeckCreated = (deckId: string) => {
    setActiveDeckId(deckId);
    setCurrentView("deck");
  };

  const handleOpenDeck = (deckId: string) => {
    setActiveDeckId(deckId);
    setCurrentView("deck");
  };

  const handleGoHome = () => {
    setCurrentView("dashboard");
    setActiveDeckId(null);
    setDeckTitle("");
  };

  const saveDeckTitle = (title: string) => {
    const newDeck: Deck = deck;
    deck.title = title;
    saveDeck(newDeck);
    setDeckTitle(title);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };
  const deckActions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-slate-600"
        onClick={() => {
          if (isWorking) {
            showToast("Please wait while AI is working");
            return;
          }
          setIsThemePickerOpen(true);
        }}
      >
        Theme
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-slate-600"
        onClick={async () => {
          if (isWorking) {
            showToast("Please wait while processing");
            return;
          }
          if (!deck) return;
          try {
            await exportPresentation(deck, 'pptx');
            showToast("Presentation downloaded!");
          } catch (error) {
            console.error("Export failed:", error);
            showToast("Export failed. Please try again.");
          }
        }}
      >
        Export
      </Button>
      <Button
        size="sm"
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6"
        onClick={() => {
          if (isWorking) {
            showToast("Please wait while AI is working");
            return;
          }
          setIsPresentationMode(true);
        }}
      >
        Present
      </Button>
    </>
  );

  return (
    <>
      {toast && (
        <div className="fixed top-26 right-6 z-[99999] bg-black/90 text-white text-sm px-4 py-2 rounded shadow-lg">
          {toast}
        </div>
      )}
        <Layout
          onGoHome={handleGoHome}
          currentView={currentView}
          title={currentView === "deck" ? deckTitle : undefined}
          saveDeckTitle={saveDeckTitle}
          headerActions={currentView === "deck" ? deckActions : undefined}
          isWorking={isWorking}
          showToast={showToast}
        >
          {currentView === "dashboard" && (
            <Dashboard
              onCreateNew={handleCreateNew}
              onOpenDeck={handleOpenDeck}
            />
          )}

          {currentView === "deck" && activeDeckId && (
            <DeckView
              deckId={activeDeckId}
              setDeckTitle={setDeckTitle}
              isThemePickerOpen={isThemePickerOpen}
              onCloseThemePicker={() => setIsThemePickerOpen(false)}
              activeSlideIndex={activeSlideIndex}
              setActiveSlideIndex={setActiveSlideIndex}
              deck={deck}
              setDeck={setDeck}
              isPresentationMode={isPresentationMode}
              setIsPresentationMode={setIsPresentationMode}
              isWorking={isWorking}
              setIsWorking={setIsWorking}
              showToast={showToast}
            />
          )}
        </Layout>
    </>
  );
};

export default App;
