import React, { useState, useEffect } from "react";
import { Search, Loader2, X, ChevronDown } from "lucide-react";

interface PexelsImage {
  id: number;
  src: { medium: string; large: string };
  photographer: string;
  alt: string;
}

export const ImageLibrary: React.FC<{
  onSelect: (url: string) => void;
  onClose: () => void;
}> = ({ onSelect, onClose }) => {
  const [query, setQuery] = useState("");
  const [images, setImages] = useState<PexelsImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchImages = async (searchTerm: string, pageNum: number) => {
    // Only clear images if it's a new search (page 1)
    if (pageNum === 1) {
      setImages([]);
    }
    
    setLoading(true);
    
    try {
      // Use the current query or default to "business" if empty
      const queryTerm = searchTerm || "business";
      
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${queryTerm}&per_page=40&page=${pageNum}`,
        {
          headers: {
            Authorization: process.env.PEXELS_API_KEY || "", 
          },
        }
      );
      
      if (!res.ok) throw new Error("Failed to fetch");

      const data = await res.json();
      const newPhotos = data.photos || [];

      // If page 1, replace. If page > 1, append.
      setImages((prev) => (pageNum === 1 ? newPhotos : [...prev, ...newPhotos]));
      
      // If we got fewer photos than requested, we reached the end
      setHasMore(newPhotos.length === 40);
      
    } catch (err) {
      console.error("Pexels error", err);
    } finally {
      setLoading(false);
    }
  };

  // Initial Load
  useEffect(() => {
    fetchImages("business", 1);
  }, []);

  const handleSearch = () => {
    setPage(1); // Reset page
    fetchImages(query, 1);
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchImages(query, nextPage);
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 w-80 shadow-xl animate-in slide-in-from-right">
      {/* Header */}
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="font-bold text-sm uppercase tracking-wider text-slate-500">
          Stock Photos
        </h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-slate-100 rounded-full"
        >
          <X size={18} />
        </button>
      </div>

      {/* Search Input */}
      <div className="p-3">
        <div className="relative">
          <Search
            className="absolute left-3 top-2.5 text-slate-400"
            size={16}
          />
          <input
            className="w-full bg-slate-100 border-none rounded-lg py-2 pl-9 pr-4 text-sm focus:ring-2 focus:ring-indigo-500"
            placeholder="Search Pexels..."
            value={query}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Image Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Only show full page loader if searching new term (page 1) */}
        {loading && page === 1 ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-indigo-600" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {images.map((img) => (
                <img
                  key={img.id}
                  src={img.src.medium}
                  alt={img.alt}
                  className="rounded cursor-pointer hover:opacity-80 transition aspect-square object-cover w-full"
                  onClick={() => onSelect(img.src.large)}
                />
              ))}
            </div>

            {/* Empty State */}
            {!loading && images.length === 0 && (
              <div className="text-center py-10 text-slate-400 text-sm">
                No images found.
              </div>
            )}

            {/* Load More Button */}
            {images.length > 0 && hasMore && (
              <div className="py-4 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="flex items-center gap-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-full transition disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  {loading ? "Loading..." : "Load More"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 text-[10px] text-center text-slate-400 border-t">
        Photos provided by{" "}
        <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="underline">
          Pexels
        </a>
      </div>
    </div>
  );
};
