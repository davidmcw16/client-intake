const questions = [
  {
    id: 1,
    text: "Let's start simple. Tell me your name, and in a couple of sentences, what do you want to build?",
    spoken: "Let's start simple. Tell me your name, and in a couple of sentences, what do you want to build?",
    frameworkSection: "FEATURE",
    subsection: "Vision",
    hint: "Just describe the big idea — no technical details needed."
  },
  {
    id: 2,
    text: "Who will use this, and what problem does it solve for them?",
    spoken: "Great. Now, who will actually use this? And what problem does it solve for them?",
    frameworkSection: "FEATURE",
    subsection: "Problem & Users",
    hint: "Think about your ideal customer and their daily frustrations."
  },
  {
    id: 3,
    text: "What are the 2 or 3 main things it absolutely needs to do?",
    spoken: "What are the two or three main things it absolutely needs to do? Like, the must-haves for it to be useful.",
    frameworkSection: "TOOLS",
    subsection: "Core Capabilities",
    hint: "The non-negotiable features — what makes it work."
  },
  {
    id: 4,
    text: "Walk me through what someone would do when they use it — step by step.",
    spoken: "Now walk me through what someone would actually do when they use it. Step by step, from the moment they open it.",
    frameworkSection: "EXPERIENCE",
    subsection: "User Journey",
    hint: "Imagine watching someone use it over their shoulder."
  },
  {
    id: 5,
    text: "How should it look and feel? Describe the vibe — colors, style, mood.",
    spoken: "How should it look and feel? Describe the vibe you're going for. Is it sleek and modern? Warm and friendly? Bold and colorful? Paint me a picture.",
    frameworkSection: "DESIGN",
    subsection: "Look & Feel",
    hint: "Think about the mood and personality you want it to have."
  },
  {
    id: 6,
    text: "Does it need to connect to any other tools, apps, or services you already use?",
    spoken: "Does it need to connect to any other tools, apps, or services you already use? Things like email, calendars, payment systems, or anything else.",
    frameworkSection: "DEPENDENCIES",
    subsection: "External Systems",
    hint: "Any existing tools or platforms it should work with."
  },
  {
    id: 7,
    text: "How many people do you expect to use this? Dozens, hundreds, thousands?",
    spoken: "How many people do you expect to use this? Are we talking a small team of a dozen, a few hundred, or potentially thousands of users?",
    frameworkSection: "DEPENDENCIES",
    subsection: "Scale & Performance",
    hint: "A rough idea of how big this could get."
  },
  {
    id: 8,
    text: "Any timeline, budget, or other important details I should know?",
    spoken: "Last one. Any timeline or budget you're working with? Or anything else important I should know about?",
    frameworkSection: "OTHER",
    subsection: "Constraints & Notes",
    hint: "Deadlines, budget range, preferences — anything goes."
  }
];

const welcomeMessage = "Hi there! I'm going to ask you a few quick questions about your project idea. Just speak naturally — there are no wrong answers. Ready? Let's go.";

const completionMessage = "That's everything I need. Thanks for sharing all of that. Your project brief is ready to download.";

module.exports = { questions, welcomeMessage, completionMessage };
