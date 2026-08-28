import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Map,
  Satellite,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050914] text-white overflow-hidden">

      {/* ================= BACKGROUND ================= */}

      <div className="fixed inset-0 -z-10 pointer-events-none">

        <div
          className="
            absolute
            top-[-250px]
            left-1/2
            -translate-x-1/2
            w-[800px]
            h-[800px]
            rounded-full
            bg-cyan-500/10
            blur-[160px]
          "
        />

        <div
          className="
            absolute
            bottom-[-300px]
            right-[-200px]
            w-[600px]
            h-[600px]
            rounded-full
            bg-blue-600/10
            blur-[150px]
          "
        />

      </div>


      {/* ================= NAVBAR ================= */}

      <header className="border-b border-white/10 bg-[#050914]/80 backdrop-blur-xl">

        <div
          className="
            max-w-7xl
            mx-auto
            px-6
            py-5
            flex
            items-center
            justify-between
          "
        >

          {/* LOGO */}

          <a
            href="/"
            className="flex items-center gap-3"
          >

            <div
              className="
                w-11
                h-11
                rounded-xl
                border
                border-cyan-400/20
                bg-cyan-400/10
                flex
                items-center
                justify-center
              "
            >

              <Satellite
                size={23}
                className="text-cyan-400"
              />

            </div>


            <div>

              <div className="text-lg font-bold tracking-wide">

                SATQUERY

                <span className="text-cyan-400">
                  {" "}AI
                </span>

              </div>

              <div
                className="
                  text-[10px]
                  text-gray-500
                  tracking-[0.2em]
                "
              >
                EARTH OBSERVATION INTELLIGENCE
              </div>

            </div>

          </a>


          {/* NAVIGATION */}

          <nav
            className="
              hidden
              md:flex
              items-center
              gap-8
              text-sm
              text-gray-400
            "
          >

            <a
              href="/"
              className="text-white"
            >
              Dashboard
            </a>

            <a
              href="/analyze"
              className="hover:text-white transition"
            >
              Analyze
            </a>

            <a
              href="/analyze"
              className="hover:text-white transition"
            >
              Change Detection
            </a>

            <a
              href="/analyze"
              className="hover:text-white transition"
            >
              Satellite Explorer
            </a>

          </nav>


          {/* LAUNCH DEMO */}

          <a
            href="/analyze?demo=true"
            className="
              hidden
              md:flex
              items-center
              gap-2
              px-5
              py-2.5
              rounded-xl
              border
              border-white/10
              bg-white/5
              hover:bg-white/10
              transition
              text-sm
              font-medium
            "
          >

            <Sparkles
              size={16}
              className="text-cyan-400"
            />

            Launch Demo

          </a>

        </div>

      </header>


      {/* ================= HERO ================= */}

      <section
        className="
          max-w-7xl
          mx-auto
          px-6
          pt-24
          pb-24
        "
      >

        <div
          className="
            grid
            lg:grid-cols-2
            gap-16
            items-center
          "
        >

          {/* ================= LEFT ================= */}

          <div>

            {/* BADGE */}

            <div
              className="
                inline-flex
                items-center
                gap-2
                px-4
                py-2
                rounded-full
                border
                border-cyan-400/20
                bg-cyan-400/5
                text-cyan-300
                text-xs
                tracking-wide
              "
            >

              <Activity size={14} />

              AI-POWERED EARTH OBSERVATION

            </div>


            {/* HEADING */}

            <h1
              className="
                mt-7
                text-5xl
                md:text-7xl
                font-bold
                leading-[1.05]
                tracking-tight
              "
            >

              Ask the Earth.

              <br />

              <span className="text-cyan-400">
                Get Evidence.
              </span>

            </h1>


            {/* DESCRIPTION */}

            <p
              className="
                mt-7
                max-w-xl
                text-lg
                leading-relaxed
                text-gray-400
              "
            >

              SatQuery AI is an interactive vision-language
              assistant that transforms natural-language questions
              into intelligent multimodal remote-sensing analysis.

            </p>


            {/* BUTTONS */}

            <div
              className="
                mt-9
                flex
                flex-wrap
                gap-4
              "
            >

              {/* START ANALYSIS */}

              <a
                href="/analyze"
                className="
                  group
                  inline-flex
                  items-center
                  gap-3
                  px-7
                  py-3.5
                  rounded-xl
                  bg-cyan-400
                  text-black
                  font-semibold
                  hover:bg-cyan-300
                  transition
                  shadow-lg
                  shadow-cyan-500/10
                "
              >

                Start Analysis

                <ArrowRight
                  size={19}
                  className="
                    transition
                    group-hover:translate-x-1
                  "
                />

              </a>


              {/* EXPLORE DEMO */}

              <a
                href="/analyze?demo=true"
                className="
                  inline-flex
                  items-center
                  gap-2
                  px-7
                  py-3.5
                  rounded-xl
                  border
                  border-white/10
                  bg-white/5
                  hover:bg-white/10
                  transition
                  font-medium
                "
              >

                Explore Demo

              </a>

            </div>


            {/* TRUST ITEMS */}

            <div
              className="
                mt-10
                flex
                flex-wrap
                items-center
                gap-7
                text-xs
                text-gray-500
              "
            >

              <div className="flex items-center gap-2">

                <ShieldCheck
                  size={16}
                  className="text-cyan-400"
                />

                Evidence Grounded

              </div>


              <div className="flex items-center gap-2">

                <BrainCircuit
                  size={16}
                  className="text-cyan-400"
                />

                Vision-Language AI

              </div>


              <div className="flex items-center gap-2">

                <Map
                  size={16}
                  className="text-cyan-400"
                />

                Geospatial Intelligence

              </div>

            </div>

          </div>


          {/* ================= RIGHT VISUAL ================= */}

          <div className="relative">

            <div
              className="
                relative
                max-w-[540px]
                aspect-square
                mx-auto
                rounded-[40px]
                border
                border-white/10
                bg-gradient-to-br
                from-cyan-500/10
                via-blue-500/5
                to-transparent
                overflow-hidden
              "
            >

              {/* RADAR RINGS */}

              <div
                className="
                  absolute
                  top-1/2
                  left-1/2
                  -translate-x-1/2
                  -translate-y-1/2
                  w-[430px]
                  h-[430px]
                  rounded-full
                  border
                  border-cyan-400/10
                "
              />

              <div
                className="
                  absolute
                  top-1/2
                  left-1/2
                  -translate-x-1/2
                  -translate-y-1/2
                  w-[330px]
                  h-[330px]
                  rounded-full
                  border
                  border-cyan-400/10
                "
              />

              <div
                className="
                  absolute
                  top-1/2
                  left-1/2
                  -translate-x-1/2
                  -translate-y-1/2
                  w-[230px]
                  h-[230px]
                  rounded-full
                  border
                  border-cyan-400/10
                "
              />


              {/* EARTH */}

              <div
                className="
                  absolute
                  top-1/2
                  left-1/2
                  -translate-x-1/2
                  -translate-y-1/2
                  w-52
                  h-52
                  rounded-full
                  bg-gradient-to-br
                  from-cyan-400/50
                  via-blue-700/40
                  to-[#020617]
                  border
                  border-cyan-300/20
                  shadow-[0_0_100px_rgba(34,211,238,0.18)]
                "
              >

                <div
                  className="
                    absolute
                    inset-0
                    rounded-full
                    bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.2),transparent_35%)]
                  "
                />

              </div>


              {/* CHANGE DETECTION CARD */}

              <div
                className="
                  absolute
                  top-10
                  left-8
                  px-4
                  py-3
                  rounded-xl
                  border
                  border-white/10
                  bg-black/60
                  backdrop-blur-xl
                "
              >

                <div className="flex items-center gap-2">

                  <ScanSearch
                    size={17}
                    className="text-cyan-400"
                  />

                  <span className="text-sm font-medium">
                    Change Detection
                  </span>

                </div>

                <p className="mt-1 text-[10px] text-gray-500">
                  Analysis ready
                </p>

              </div>


              {/* AI CARD */}

              <div
                className="
                  absolute
                  top-1/2
                  right-7
                  -translate-y-1/2
                  px-4
                  py-3
                  rounded-xl
                  border
                  border-white/10
                  bg-black/60
                  backdrop-blur-xl
                "
              >

                <div className="flex items-center gap-2">

                  <BrainCircuit
                    size={17}
                    className="text-cyan-400"
                  />

                  <span className="text-sm font-medium">
                    Vision AI
                  </span>

                </div>

                <p className="mt-1 text-[10px] text-gray-500">
                  Query understood
                </p>

              </div>


              {/* GEOSPATIAL CARD */}

              <div
                className="
                  absolute
                  bottom-10
                  right-8
                  px-4
                  py-3
                  rounded-xl
                  border
                  border-white/10
                  bg-black/60
                  backdrop-blur-xl
                "
              >

                <div className="flex items-center gap-2">

                  <Map
                    size={17}
                    className="text-cyan-400"
                  />

                  <span className="text-sm font-medium">
                    Geospatial AI
                  </span>

                </div>

                <p className="mt-1 text-[10px] text-gray-500">
                  Evidence grounded
                </p>

              </div>

            </div>

          </div>

        </div>

      </section>


      {/* ================= PIPELINE ================= */}

      <section
        className="
          border-y
          border-white/10
          bg-white/[0.02]
        "
      >

        <div className="max-w-7xl mx-auto px-6 py-20">

          <div className="text-center mb-12">

            <p
              className="
                text-xs
                text-cyan-400
                tracking-[0.3em]
              "
            >
              INTELLIGENCE PIPELINE
            </p>

            <h2
              className="
                mt-3
                text-3xl
                md:text-4xl
                font-bold
              "
            >
              From Question to Evidence
            </h2>

            <p
              className="
                mt-4
                text-gray-500
                max-w-2xl
                mx-auto
              "
            >
              SatQuery AI converts natural-language questions
              into explainable remote-sensing insights.
            </p>

          </div>


          <div
            className="
              grid
              md:grid-cols-5
              gap-4
            "
          >

            {[
              {
                number: "01",
                title: "Natural Language",
                description:
                  "Ask a question about an area or satellite image.",
              },
              {
                number: "02",
                title: "Query Understanding",
                description:
                  "AI identifies what the user is asking.",
              },
              {
                number: "03",
                title: "Analysis",
                description:
                  "Select appropriate remote-sensing operations.",
              },
              {
                number: "04",
                title: "Evidence",
                description:
                  "Extract measurable spatial information.",
              },
              {
                number: "05",
                title: "Explanation",
                description:
                  "Return an understandable AI-generated answer.",
              },
            ].map((item) => (

              <div
                key={item.number}
                className="
                  p-6
                  rounded-2xl
                  border
                  border-white/10
                  bg-white/[0.03]
                  hover:bg-white/[0.05]
                  transition
                "
              >

                <div className="text-xs text-cyan-400">
                  {item.number}
                </div>

                <h3 className="mt-4 font-semibold">
                  {item.title}
                </h3>

                <p
                  className="
                    mt-2
                    text-sm
                    leading-relaxed
                    text-gray-500
                  "
                >
                  {item.description}
                </p>

              </div>

            ))}

          </div>

        </div>

      </section>


      {/* ================= FEATURES ================= */}

      <section className="max-w-7xl mx-auto px-6 py-20">

        <div className="text-center mb-14">

          <p
            className="
              text-xs
              text-cyan-400
              tracking-[0.3em]
            "
          >
            CORE CAPABILITIES
          </p>

          <h2
            className="
              mt-3
              text-3xl
              md:text-4xl
              font-bold
            "
          >
            Intelligent Earth Observation
          </h2>

        </div>


        <div
          className="
            grid
            md:grid-cols-2
            lg:grid-cols-3
            gap-6
          "
        >

          {[
            {
              icon: BrainCircuit,
              title: "Vision-Language AI",
              description:
                "Ask questions about satellite imagery using natural language.",
            },
            {
              icon: ScanSearch,
              title: "Multispectral Analysis",
              description:
                "Analyze spectral information using NDVI, NDWI, NDBI and other indices.",
            },
            {
              icon: Map,
              title: "Geospatial Intelligence",
              description:
                "Visualize analysis results directly on geographic maps.",
            },
            {
              icon: Activity,
              title: "Change Detection",
              description:
                "Compare observations across different dates to identify changes.",
            },
            {
              icon: ShieldCheck,
              title: "Evidence Grounding",
              description:
                "Connect AI answers with measurable remote-sensing evidence.",
            },
            {
              icon: Satellite,
              title: "Satellite Explorer",
              description:
                "Explore satellite observations by location, date and coverage.",
            },
          ].map((feature) => {

            const Icon = feature.icon;

            return (

              <div
                key={feature.title}
                className="
                  group
                  p-7
                  rounded-2xl
                  border
                  border-white/10
                  bg-white/[0.03]
                  hover:border-cyan-400/30
                  hover:bg-cyan-400/[0.03]
                  transition
                "
              >

                <div
                  className="
                    w-12
                    h-12
                    rounded-xl
                    bg-cyan-400/10
                    flex
                    items-center
                    justify-center
                  "
                >

                  <Icon
                    size={22}
                    className="text-cyan-400"
                  />

                </div>

                <h3 className="mt-5 text-lg font-semibold">
                  {feature.title}
                </h3>

                <p
                  className="
                    mt-3
                    text-sm
                    leading-relaxed
                    text-gray-500
                  "
                >
                  {feature.description}
                </p>

              </div>

            );

          })}

        </div>

      </section>


      {/* ================= FINAL CTA ================= */}

      <section className="max-w-5xl mx-auto px-6 pb-24">

        <div
          className="
            relative
            rounded-3xl
            border
            border-cyan-400/20
            bg-gradient-to-br
            from-cyan-400/10
            to-blue-500/5
            p-10
            md:p-16
            text-center
            overflow-hidden
          "
        >

          <div
            className="
              absolute
              top-[-100px]
              left-1/2
              -translate-x-1/2
              w-[400px]
              h-[200px]
              bg-cyan-400/10
              blur-[100px]
            "
          />

          <div className="relative">

            <Sparkles
              size={30}
              className="mx-auto text-cyan-400"
            />

            <h2
              className="
                mt-5
                text-3xl
                md:text-4xl
                font-bold
              "
            >
              Explore the Earth with AI.
            </h2>

            <p
              className="
                mt-4
                text-gray-400
                max-w-xl
                mx-auto
              "
            >
              Upload satellite imagery, ask questions,
              and turn remote-sensing data into actionable evidence.
            </p>

            <a
              href="/analyze"
              className="
                inline-flex
                items-center
                gap-2
                mt-8
                px-7
                py-3.5
                rounded-xl
                bg-cyan-400
                text-black
                font-semibold
                hover:bg-cyan-300
                transition
              "
            >

              Start Analysis

              <ArrowRight size={18} />

            </a>

          </div>

        </div>

      </section>


      {/* ================= FOOTER ================= */}

      <footer className="border-t border-white/10">

        <div
          className="
            max-w-7xl
            mx-auto
            px-6
            py-8
            flex
            flex-col
            md:flex-row
            items-center
            justify-between
            gap-4
            text-xs
            text-gray-500
          "
        >

          <p>
            © 2026 SatQuery AI
          </p>

          <p>
            SIH26167 · Space Technology
          </p>

          <p>
            Vision-Language Remote Sensing Assistant
          </p>

        </div>

      </footer>

    </main>
  );
}