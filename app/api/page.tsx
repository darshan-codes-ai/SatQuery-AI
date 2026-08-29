"use client";

import { useState } from "react";
import SatelliteMap from "@/components/SatelliteMap";

import {
  Activity,
  BarChart3,
  Calendar,
  Cloud,
  Eye,
  Layers,
  MapPin,
  Maximize2,
  Search,
  Send,
  Settings,
  Satellite,
  Sparkles,
  Upload,
  Waves,
  X,
  Zap,
} from "lucide-react";

export default function AnalyzePage() {
  // =========================================================
  // STATE
  // =========================================================

  // User's text query
  const [query, setQuery] = useState("");

  const [selectedCoordinates, setSelectedCoordinates] = useState({
  lat: 21.1938,
  lng: 81.3509,
    }); 
    
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState({
  ndvi: 0,
  ndwi: 0,
  ndbi: 0,
  coverage: 0,
  confidence: 0,
});

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);

  // Whether analysis has been performed
  const [analysisStarted, setAnalysisStarted] = useState(false);

  // Uploaded image preview
  const [uploadedImage, setUploadedImage] =
    useState<string | null>(null);

  // Uploaded image filename
  const [imageName, setImageName] = useState("");

  // Currently selected map layer
  const [activeLayer, setActiveLayer] = useState("RGB");

  // Chat messages
  const [messages, setMessages] = useState<
    {
      role: "user" | "ai";
      text: string;
    }[]
  >([]);

  // =========================================================
  // SUGGESTED QUESTIONS
  // =========================================================

  const suggestedQueries = [
    "Show vegetation health in this area",
    "Detect changes between two dates",
    "Find water bodies",
    "Identify urban expansion",
  ];

  // =========================================================
  // MAP LAYERS
  // =========================================================

  const layers = [
    "RGB",
    "NDVI",
    "NDWI",
    "NDBI",
  ];

  // =========================================================
  // IMAGE UPLOAD
  // =========================================================

  const handleImageUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) return;

    // Supported image formats
    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];

    // Check file type
    if (!allowedTypes.includes(file.type)) {
      alert(
        "Please upload a PNG, JPG, JPEG or WEBP image."
      );

      return;
    }

    // Create temporary browser preview URL
    const imageURL = URL.createObjectURL(file);

    // Save image information
    setUploadedImage(imageURL);
    setImageName(file.name);

    // Close modal
    setShowUpload(false);
  };

  // =========================================================
  // REMOVE IMAGE
  // =========================================================

  const removeImage = () => {
    setUploadedImage(null);
    setImageName("");
  };

  // =========================================================
  // RUN AI QUERY
  // =========================================================

  const runQuery = async (text: string) => {
  if (!text.trim() || isAnalyzing) return;

  setMessages((previous) => [
    ...previous,
    {
      role: "user",
      text: text.trim(),
    },
  ]);

  setQuery("");
  setIsAnalyzing(true);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: text.trim(),
        coordinates: {
          lat: selectedCoordinates.lat,
          lng: selectedCoordinates.lng,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || "Analysis failed."
      );
    }

    setMessages((previous) => [
      ...previous,
      {
        role: "ai",
        text: data.response,
      },
    ]);

    setAnalysisResults({
      ndvi: data.analysis.indices.ndvi,
      ndwi: data.analysis.indices.ndwi,
      ndbi: data.analysis.indices.ndbi,
      coverage: data.analysis.coverage,
      confidence: data.confidence,
    });

    setAnalysisStarted(true);
  } catch (error) {
    console.error(
      "SatQuery analysis error:",
      error
    );

    setMessages((previous) => [
      ...previous,
      {
        role: "ai",
        text:
          "I couldn't complete the analysis. Please try again.",
      },
    ]);
  } finally {
    setIsAnalyzing(false);
  }
};

  // =========================================================
  // PAGE
  // =========================================================

  return (
    <main className="min-h-screen bg-[#040812] text-white">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="h-16 border-b border-white/10 bg-[#060b16]/95 backdrop-blur-xl">

        <div className="h-full px-5 flex items-center justify-between">

          {/* LOGO */}

          <a
            href="/"
            className="flex items-center gap-3"
          >

            <div
              className="
                w-9
                h-9
                rounded-lg
                bg-cyan-400/10
                border
                border-cyan-400/20
                flex
                items-center
                justify-center
              "
            >

              <Satellite
                size={20}
                className="text-cyan-400"
              />

            </div>

            <div>

              <div className="font-bold tracking-wide">

                SATQUERY
                <span className="text-cyan-400">
                  {" "}AI
                </span>

              </div>

              <div
                className="
                  text-[9px]
                  text-gray-500
                  tracking-[0.2em]
                "
              >
                EARTH OBSERVATION
              </div>

            </div>

          </a>


          {/* WORKSPACE STATUS */}

          <div className="hidden md:flex items-center gap-3">

            <div
              className="
                w-1.5
                h-1.5
                rounded-full
                bg-emerald-400
                animate-pulse
              "
            />

            <span className="text-xs text-gray-400">
              ANALYSIS WORKSPACE
            </span>

          </div>


          {/* HEADER BUTTONS */}

          <div className="flex items-center gap-2">

            <button
              className="
                p-2
                rounded-lg
                hover:bg-white/5
                transition
              "
            >

              <Settings
                size={18}
                className="text-gray-400"
              />

            </button>

            <button
              className="
                p-2
                rounded-lg
                hover:bg-white/5
                transition
              "
            >

              <Maximize2
                size={18}
                className="text-gray-400"
              />

            </button>

          </div>

        </div>

      </header>


      {/* =====================================================
          MAIN LAYOUT
      ===================================================== */}

      <div
        className="
          grid
          lg:grid-cols-[1fr_390px]
          min-h-[calc(100vh-64px)]
        "
      >

        {/* ===================================================
            LEFT SIDE
        =================================================== */}

        <section
          className="
            min-w-0
            border-r
            border-white/10
          "
        >

          {/* =================================================
              MAP TOOLBAR
          ================================================= */}

          <div
            className="
              h-14
              border-b
              border-white/10
              flex
              items-center
              justify-between
              px-5
            "
          >

            <div className="flex items-center gap-3">

              {/* LOCATION */}

              <button
                className="
                  flex
                  items-center
                  gap-2
                  px-3
                  py-2
                  rounded-lg
                  bg-white/5
                  border
                  border-white/10
                  text-xs
                "
              >

                <MapPin
                  size={14}
                  className="text-cyan-400"
                />

                India

              </button>


              {/* DATE */}

              <button
                className="
                  hidden
                  sm:flex
                  items-center
                  gap-2
                  px-3
                  py-2
                  rounded-lg
                  bg-white/5
                  border
                  border-white/10
                  text-xs
                "
              >

                <Calendar
                  size={14}
                  className="text-cyan-400"
                />

                24 Aug 2026

              </button>

            </div>


            {/* SEARCH / LAYERS */}

            <div className="flex items-center gap-2">

              <button
                className="
                  p-2
                  rounded-lg
                  hover:bg-white/5
                "
              >

                <Search
                  size={17}
                  className="text-gray-400"
                />

              </button>

              <button
                className="
                  p-2
                  rounded-lg
                  hover:bg-white/5
                "
              >

                <Layers
                  size={17}
                  className="text-gray-400"
                />

              </button>

            </div>

          </div>


          {/* =================================================
              REAL MAP
          ================================================= */}

          <div
            className="
              relative
              h-[520px]
              lg:h-[calc(100vh-390px)]
              min-h-[480px]
              bg-[#07111c]
              overflow-hidden
            "
          >

            <SatelliteMap
              onCoordinatesChange={setSelectedCoordinates}
            />

          </div>


          {/* =================================================
              ANALYSIS METRICS
          ================================================= */}

          <div className="border-t border-white/10 p-4">

            <div
              className="
                grid
                grid-cols-2
                md:grid-cols-4
                gap-3
              "
            >

              {/* NDVI */}

              <MetricCard
                icon={<Activity size={17} />}
                title="NDVI"
                value={analysisResults.ndvi.toFixed(2)}
                subtitle="Vegetation health"
              />


              {/* NDWI */}

              <MetricCard
                icon={<Waves size={17} />}
                title="NDWI"
                value={analysisResults.ndwi.toFixed(2)}
                subtitle="Water presence"
              />


              {/* NDBI */}

              <MetricCard
                icon={<BarChart3 size={17} />}
                title="NDBI"
                value={analysisResults.ndbi.toFixed(2)}
                subtitle="Built-up index"
              />


              {/* COVERAGE */}

              <MetricCard
                icon={<Eye size={17} />}
                title="Coverage"
                value={`${analysisResults.coverage.toFixed(1)}%`}
                subtitle="Vegetated area"
              />

            </div>

          </div>

        </section>


        {/* ===================================================
            RIGHT SIDE — AI ASSISTANT
        =================================================== */}

        <aside
          className="
            flex
            flex-col
            bg-[#060b15]
          "
        >

          {/* =================================================
              AI HEADER
          ================================================= */}

          <div
            className="
              h-14
              border-b
              border-white/10
              px-5
              flex
              items-center
              justify-between
            "
          >

            <div className="flex items-center gap-3">

              <div
                className="
                  w-8
                  h-8
                  rounded-lg
                  bg-cyan-400/10
                  flex
                  items-center
                  justify-center
                "
              >

                <Sparkles
                  size={17}
                  className="text-cyan-400"
                />

              </div>

              <div>

                <div className="text-sm font-semibold">
                  SatQuery Assistant
                </div>

                <div className="text-[10px] text-emerald-400">
                  ● ONLINE
                </div>

              </div>

            </div>

          </div>


          {/* =================================================
              CHAT AREA
          ================================================= */}

          <div
            className="
              flex-1
              overflow-y-auto
              p-5
              space-y-5
            "
          >

            {/* =================================================
                UPLOADED IMAGE
            ================================================= */}

            {uploadedImage && (

              <div>

                <div
                  className="
                    text-[10px]
                    text-gray-500
                    uppercase
                    tracking-widest
                    mb-2
                  "
                >
                  Uploaded Imagery
                </div>


                <div
                  className="
                    relative
                    rounded-xl
                    overflow-hidden
                    border
                    border-cyan-400/20
                    bg-black
                  "
                >

                  <img
                    src={uploadedImage}
                    alt="Uploaded satellite imagery"
                    className="
                      w-full
                      max-h-60
                      object-contain
                    "
                  />


                  {/* REMOVE IMAGE */}

                  <button
                    onClick={removeImage}
                    className="
                      absolute
                      top-2
                      right-2
                      w-8
                      h-8
                      rounded-lg
                      bg-black/80
                      border
                      border-white/10
                      flex
                      items-center
                      justify-center
                      hover:bg-red-500/20
                      transition
                    "
                  >

                    <X
                      size={15}
                      className="text-gray-300"
                    />

                  </button>

                </div>


                <div
                  className="
                    mt-2
                    text-[10px]
                    text-gray-500
                    truncate
                  "
                >

                  📎 {imageName}

                </div>

              </div>

            )}


            {/* =================================================
                WELCOME MESSAGE
            ================================================= */}

            {messages.length === 0 && (

              <div>

                <div className="flex items-start gap-3">

                  <div
                    className="
                      w-8
                      h-8
                      rounded-lg
                      bg-cyan-400/10
                      flex
                      items-center
                      justify-center
                      shrink-0
                    "
                  >

                    <Sparkles
                      size={16}
                      className="text-cyan-400"
                    />

                  </div>


                  <div>

                    <p
                      className="
                        text-sm
                        leading-relaxed
                        text-gray-300
                      "
                    >

                      Hello! I'm your remote-sensing
                      intelligence assistant.

                    </p>

                    <p
                      className="
                        text-xs
                        text-gray-500
                        mt-2
                        leading-relaxed
                      "
                    >

                      Upload a satellite image or ask
                      questions about vegetation, water,
                      urban growth and land-cover changes.

                    </p>

                  </div>

                </div>


                {/* =================================================
                    SUGGESTED QUESTIONS
                ================================================= */}

                <div className="mt-6">

                  <p
                    className="
                      text-[10px]
                      text-gray-600
                      uppercase
                      tracking-widest
                      mb-3
                    "
                  >
                    Suggested Queries
                  </p>


                  <div className="space-y-2">

                    {suggestedQueries.map((item) => (

                      <button
                        key={item}
                        onClick={() => runQuery(item)}
                        className="
                          w-full
                          text-left
                          px-3
                          py-3
                          rounded-xl
                          border
                          border-white/10
                          bg-white/[0.02]
                          hover:bg-white/[0.05]
                          hover:border-cyan-400/20
                          transition
                          text-xs
                          text-gray-400
                        "
                      >

                        {item}

                      </button>

                    ))}

                  </div>

                </div>

              </div>

            )}


            {/* =================================================
                CHAT MESSAGES
            ================================================= */}

            {messages.map((message, index) => (

              <div
                key={index}
                className={`
                  flex
                  gap-3
                  ${
                    message.role === "user"
                      ? "justify-end"
                      : "justify-start"
                  }
                `}
              >

                {/* AI ICON */}

                {message.role === "ai" && (

                  <div
                    className="
                      w-8
                      h-8
                      rounded-lg
                      bg-cyan-400/10
                      flex
                      items-center
                      justify-center
                      shrink-0
                    "
                  >

                    <Sparkles
                      size={15}
                      className="text-cyan-400"
                    />

                  </div>

                )}


                {/* MESSAGE */}

                <div
                  className={`
                    max-w-[85%]
                    rounded-2xl
                    px-4
                    py-3
                    text-xs
                    leading-relaxed
                    ${
                      message.role === "user"
                        ? "bg-cyan-400 text-black"
                        : "bg-white/5 border border-white/10 text-gray-300"
                    }
                  `}
                >

                  {message.text}

                </div>

              </div>

            ))}


            {/* =================================================
                ANALYSIS EVIDENCE
            ================================================= */}

            {analysisStarted && (

              <div
                className="
                  rounded-2xl
                  border
                  border-cyan-400/20
                  bg-cyan-400/[0.03]
                  p-4
                "
              >

                <div className="flex items-center gap-2 mb-4">

                  <Zap
                    size={15}
                    className="text-cyan-400"
                  />

                  <span className="text-xs font-semibold">
                    ANALYSIS EVIDENCE
                  </span>

                </div>


                {/* EVIDENCE VALUES */}

                <div className="grid grid-cols-2 gap-3">

                  <div
                    className="
                      rounded-xl
                      bg-black/20
                      p-3
                    "
                  >

                    <div className="text-[10px] text-gray-500">
                      NDVI
                    </div>

                    <div
                      className="
                        text-lg
                        font-bold
                        text-cyan-300
                        mt-1
                      "
                    >
                      {analysisResults.ndvi.toFixed(2)}
                    </div>

                  </div>


                  <div
                    className="
                      rounded-xl
                      bg-black/20
                      p-3
                    "
                  >

                    <div className="text-[10px] text-gray-500">
                      CONFIDENCE
                    </div>

                    <div
                      className="
                        text-lg
                        font-bold
                        text-emerald-400
                        mt-1
                      "
                    >
                      {Math.round(analysisResults.confidence * 100)}%
                    </div>

                  </div>

                </div>


                {/* VEGETATION BAR */}

                <div className="mt-4">

                  <div
                    className="
                      flex
                      justify-between
                      text-[10px]
                      text-gray-500
                      mb-2
                    "
                  >

                    <span>
                      Vegetation coverage
                    </span>

                    <span>
                      
                    </span>

                  </div>


                  <div
                    className="
                      h-1.5
                      rounded-full
                      bg-white/10
                      overflow-hidden
                    "
                  >

                    <div
                      className="
                        h-full
                        bg-cyan-400
                        rounded-full
                      "
                      style={{
                        width: `${Math.min(
                        100,
                        Math.max(0, analysisResults.coverage)
                      )}%`,
                    }}
                    />

                  </div>

                </div>


                {/* SHOW EVIDENCE */}

                <button
                  className="
                    w-full
                    mt-4
                    py-2
                    rounded-lg
                    border
                    border-white/10
                    hover:bg-white/5
                    text-xs
                    text-gray-400
                  "
                >

                  Show Evidence on Map

                </button>

              </div>

            )}

          </div>


          {/* =================================================
              QUERY INPUT
          ================================================= */}

          <div
            className="
              border-t
              border-white/10
              p-4
            "
          >

            <div className="relative">

              <textarea
                value={query}
                onChange={(event) =>
                  setQuery(event.target.value)
                }
                onKeyDown={(event) => {

                  if (
                    event.key === "Enter" &&
                    !event.shiftKey
                  ) {

                    event.preventDefault();

                    runQuery(query);

                  }

                }}
                placeholder={
                  uploadedImage
                    ? "Ask about this imagery..."
                    : "Ask anything about this imagery..."
                }
                rows={3}
                className="
                  w-full
                  resize-none
                  rounded-xl
                  border
                  border-white/10
                  bg-white/[0.03]
                  px-4
                  py-3
                  pr-12
                  text-sm
                  text-white
                  placeholder:text-gray-600
                  outline-none
                  focus:border-cyan-400/40
                "
              />


              {/* SEND BUTTON */}

             <button
  onClick={() => runQuery(query)}
  disabled={!query.trim() || isAnalyzing}
  className="
    absolute
    right-3
    bottom-3
    w-8
    h-8
    rounded-lg
    bg-cyan-400
    text-black
    flex
    items-center
    justify-center
    disabled:opacity-30
    hover:bg-cyan-300
    transition
  "
>
  {isAnalyzing ? (
    <span className="text-xs font-bold animate-pulse">
      ...
    </span>
  ) : (
    <Send size={15} />
  )}
</button>

            </div>


            {/* BOTTOM BAR */}

            <div
              className="
                flex
                items-center
                justify-between
                mt-3
              "
            >

              <button
                onClick={() => setShowUpload(true)}
                className="
                  flex
                  items-center
                  gap-2
                  text-[11px]
                  text-gray-500
                  hover:text-gray-300
                "
              >

                <Upload size={14} />

                {uploadedImage
                  ? "Change imagery"
                  : "Upload imagery"}

              </button>


              <span className="text-[10px] text-gray-600">
                Enter to analyze
              </span>

            </div>

          </div>

        </aside>

      </div>


      {/* =====================================================
          UPLOAD MODAL
      ===================================================== */}

      {showUpload && (

        <div
          className="
            fixed
            inset-0
            z-50
            bg-black/70
            backdrop-blur-sm
            flex
            items-center
            justify-center
            p-5
          "
        >

          <div
            className="
              w-full
              max-w-lg
              rounded-2xl
              border
              border-white/10
              bg-[#080e19]
              shadow-2xl
            "
          >

            {/* =================================================
                MODAL HEADER
            ================================================= */}

            <div
              className="
                p-5
                border-b
                border-white/10
                flex
                items-center
                justify-between
              "
            >

              <div>

                <h2 className="font-semibold">
                  Upload Satellite Imagery
                </h2>

                <p className="text-xs text-gray-500 mt-1">
                  PNG, JPG, JPEG or WEBP
                </p>

              </div>


              <button
                onClick={() => setShowUpload(false)}
                className="
                  p-2
                  rounded-lg
                  hover:bg-white/5
                "
              >

                <X
                  size={18}
                  className="text-gray-400"
                />

              </button>

            </div>


            {/* =================================================
                UPLOAD AREA
            ================================================= */}

            <div className="p-6">

              <label
                className="
                  block
                  border-2
                  border-dashed
                  border-white/10
                  hover:border-cyan-400/30
                  rounded-2xl
                  p-10
                  text-center
                  cursor-pointer
                  transition
                "
              >

                <input
                  type="file"
                  accept="
                    image/png,
                    image/jpeg,
                    image/jpg,
                    image/webp
                  "
                  className="hidden"
                  onChange={handleImageUpload}
                />


                {/* UPLOAD ICON */}

                <div
                  className="
                    w-14
                    h-14
                    rounded-2xl
                    bg-cyan-400/10
                    flex
                    items-center
                    justify-center
                    mx-auto
                  "
                >

                  <Upload
                    size={25}
                    className="text-cyan-400"
                  />

                </div>


                <h3 className="mt-5 font-medium">

                  Drop your imagery here

                </h3>


                <p className="text-xs text-gray-500 mt-2">

                  or click to browse files

                </p>

              </label>


              {/* =================================================
                  SUPPORTED DATA
              ================================================= */}

              <div
                className="
                  grid
                  grid-cols-3
                  gap-3
                  mt-5
                "
              >

                <UploadInfo
                  icon={<Satellite size={17} />}
                  text="Satellite"
                />

                <UploadInfo
                  icon={<Layers size={17} />}
                  text="Multispectral"
                />

                <UploadInfo
                  icon={<Activity size={17} />}
                  text="Analysis Ready"
                />

              </div>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}


/* =============================================================
   METRIC CARD
============================================================= */

function MetricCard({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
}) {

  return (

    <div
      className="
        rounded-xl
        border
        border-white/10
        bg-white/[0.02]
        p-4
      "
    >

      <div className="flex items-center gap-2">

        <div className="text-cyan-400">
          {icon}
        </div>

        <span className="text-[10px] text-gray-500">
          {title}
        </span>

      </div>


      <div className="mt-2 text-xl font-bold">
        {value}
      </div>


      <div className="mt-1 text-[10px] text-gray-600">
        {subtitle}
      </div>

    </div>

  );
}


/* =============================================================
   UPLOAD INFORMATION CARD
============================================================= */

function UploadInfo({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {

  return (

    <div
      className="
        p-3
        rounded-xl
        bg-white/[0.03]
        border
        border-white/10
        text-center
      "
    >

      <div className="flex justify-center text-cyan-400">

        {icon}

      </div>


      <p className="text-[10px] text-gray-500 mt-2">

        {text}

      </p>

    </div>

  );
}