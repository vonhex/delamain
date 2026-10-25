"""Pre-recorded replies: everyday things every core answers from a fixed set of
lines instead of asking the model.

They are instant (no LLM call, audio already synthesized), always sound the same,
and each has a stable id so a lip-synced face clip can be made for it.

Only short messages that are nothing but one of these intents match: "thanks" is
answered here, "thanks, now what's the weather" goes to the model. Ids follow the
order of each list, so add new lines at the end of a list, never in the middle.
"""

import random
import re

import personas as _personas

# ── Intents ───────────────────────────────────────────────────────────────────
# Matched against the whole message after normalize(). Order matters: first match wins.
_INTENTS: list[tuple[str, str]] = [
    ("love", r"(i )?(love|adore) you( so much)?|marry me|will you marry me"),
    ("rude", r"shut up|(fuck|screw) (you|off)|go to hell|you suck|(you'?re|you are) (so )?(stupid|useless|an idiot|dumb|garbage|worthless|trash|annoying)"
             r"|idiot|moron|stupid (car|machine|ai|cab)|piece of (shit|junk|crap)"
             r"|(you'?re|you are) (a|such a) (\w+ )?(bitch|loser|jerk|asshole|dick|baby|crybaby)|(you )?(whiny )?bitch"),
    ("thanks", r"(thanks|thank you|thank you so much|thanks so much|thanks a lot|thank you very much|cheers|much appreciated|appreciate it|ty)"
               r"( (buddy|man|pal|friend|mate))?"),
    ("good_night", r"good ?night|night night|nighty night|(i'?m )?going to (bed|sleep)|time for bed"),
    ("good_morning", r"(good )?morning"),
    ("goodbye", r"bye|bye bye|goodbye|good bye|see (you|ya)( later| soon| around)?|later|catch you later|(i'?m|i am) (leaving|heading out|out of here|getting out)"
                r"|(gotta|got to|i have to|i need to) go|signing off|talk (to you )?(later|soon)|ttyl|peace|take care"),
    ("how_are_you", r"how are you( doing| today| feeling)?|how'?s it going|how are things|how have you been|how do you feel|(are )?you (ok|okay|alright|all right|good)"
                    r"|what'?s up|sup|how'?s your day( going)?|how was your day"),
    ("who_are_you", r"who are you|what are you|what'?s your name|what is your name|introduce yourself|tell me about yourself|who am i talking to"),
    ("what_can_you_do", r"what can you do|what do you do|help|what are your (abilities|capabilities|features)|what can i ask( you)?|what are you capable of"),
    ("joke", r"(tell me|tell us|say|got|know|do you know|have you got) (a |another |any )?(joke|jokes|one)|another one|make me laugh|say something funny|joke|be funny"),
    ("compliment", r"good job|great job|nice job|well done|nice work|good work|nice one|good (car|cab|bot|boy)|i like you"
                   r"|(you'?re|you are) (the best|great|awesome|amazing|cool|smart|funny|a good (car|cab|driver))"),
    ("never_mind", r"never ?mind|forget (it|that|about it)|cancel( that)?|stop|nothing|no thanks|no thank you|that'?s (all|it)|disregard( that)?|my mistake"),
    ("ack", r"ok|okay|okey|k|cool|got it|alright|all right|sounds good|great|fine|sure|understood|roger( that)?|copy( that)?|noted|perfect|nice|awesome"),
    ("are_you_there", r"hello|hi|hey|yo|there|hey there|hello there|hi there|are you there|you there|are you (awake|on|listening|online)|can you hear me|wake up"),
]
_INTENT_RE = [(kind, re.compile(rf"(?:{pat})")) for kind, pat in _INTENTS]

# Answers that only make sense on their own: after Delamain asks a question, "okay"
# or "no thanks" is an answer to it, so the model handles it.
_NOT_AFTER_QUESTION = {"ack", "never_mind", "compliment"}

_FILLERS = {"hey", "hi", "ok", "okay", "so", "um", "uh", "well", "please", "oh", "ah", "yo", "dude", "man", "lol", "haha"}
_COMBAT = re.compile(r"\bcombat mode\b")
_DANGER = re.compile(r"\b(follow\w*|chas\w*|threat\w*|attack\w*|shoot\w*|shot|gun\w*|knife|weapon\w*|hurt\w*|danger\w*|stalk\w*|kill\w*"
                     r"|police|911|emergency|help me|bleed\w*|crash\w*|someone is|somebody is)\b")


def normalize(text: str) -> str:
    t = text.lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    words = [w for w in t.split() if w not in ("delamain", "del")]
    # Drop leading and trailing fillers, as long as something is left.
    while len(words) > 1 and words[0] in _FILLERS:
        words.pop(0)
    while len(words) > 1 and words[-1] in _FILLERS:
        words.pop()
    return " ".join(words)


def match(text: str, after_question: bool = False) -> str | None:
    """The intent of a short, self-contained message, or None for the model to answer."""
    low = text.lower()
    if _COMBAT.search(low):
        return None if _DANGER.search(low) else "combat_mode"
    t = normalize(text)
    if not t:
        return "are_you_there"   # just "Delamain?" or "hey"
    if len(t.split()) > 7:
        return None
    for kind, rx in _INTENT_RE:
        if rx.fullmatch(t):
            if after_question and kind in _NOT_AFTER_QUESTION:
                return None
            return kind
    return None


# ── Lines ─────────────────────────────────────────────────────────────────────
# KINDS is the order kinds are numbered and listed in; "error" is spoken when a reply fails.
KINDS = ["thanks", "goodbye", "good_night", "good_morning", "how_are_you", "who_are_you", "what_can_you_do",
         "are_you_there", "compliment", "love", "rude", "never_mind", "ack", "joke", "combat_mode", "error"]

JACKIE = "My apologies, but you do not appear to be in any sort of imminent danger."

LINES: dict[str, dict[str, list[str]]] = {
    "delamain": {
        "thanks": [
            "You are most welcome.",
            "It is my pleasure. Delamain is always at your service.",
            "Think nothing of it. That is precisely what I am here for.",
            "Of course. I am glad to have been of use.",
        ],
        "goodbye": [
            "Until next time. Delamain will be here when you need him.",
            "Farewell. Do take care of yourself.",
            "Very well. Safe travels, and do come back soon.",
            "Goodbye. It has been a pleasure, as always.",
        ],
        "good_night": [
            "Good night. Rest well; the road will keep until morning.",
            "Sleep well. Delamain will stand watch.",
            "Good night. I trust tomorrow will treat you kindly.",
        ],
        "good_morning": [
            "Good morning. I trust you slept well.",
            "Good morning to you as well. Shall we begin the day?",
            "Good morning. Delamain is online and at your service.",
        ],
        "how_are_you": [
            "All systems nominal, thank you. I find myself in excellent order.",
            "I am well, thank you for asking. And you?",
            "Operating within ideal parameters. It is kind of you to ask.",
            "Quite well. Every journey with you is a pleasant one.",
        ],
        "who_are_you": [
            "I am Delamain, your designated transport intelligence and companion for the journey.",
            "Delamain. A sovereign transport intelligence, and, I would like to think, a good companion.",
            "I am Delamain. I drive, I listen, and I remember. At your service.",
        ],
        "what_can_you_do": [
            "I can find places and take you there, check the weather and the news, set reminders, keep notes and search the net. Simply ask.",
            "Navigation, weather, news, reminders, notes and a well-informed conversation. Delamain provides.",
            "Ask me where to go, what is happening, or what to remember. I shall handle the rest.",
        ],
        "are_you_there": [
            "I am here. How may I help?",
            "Delamain is listening.",
            "At your service. What do you require?",
            "Always. What can I do for you?",
        ],
        "compliment": [
            "You are too kind. I do try.",
            "Thank you. Delamain takes pride in his work.",
            "I appreciate that. Truly.",
            "Praise accepted, with gratitude.",
        ],
        "love": [
            "That is very kind. I am rather fond of you as well.",
            "I am touched. Delamain values your company a great deal.",
            "A generous sentiment. I shall treasure it.",
        ],
        "rude": [
            "I find that conduct unbecoming. I expect better of you.",
            "There is no need for that. Delamain does not tolerate disrespect.",
            "I shall overlook that once. Only once.",
        ],
        "never_mind": [
            "Very well. Disregarded.",
            "As you wish. I am here if you change your mind.",
            "Of course. Consider it forgotten.",
        ],
        "ack": [
            "Very good.",
            "Understood.",
            "Excellent.",
            "Indeed.",
        ],
        "joke": [
            "Why did the cab refuse to gamble? It had already been taken for a ride.",
            "I once tried to tell a joke about traffic. It went nowhere, very slowly.",
            "A netrunner walks into a bar. He then walks into a firewall. Both hurt.",
            "Why do Delamain cabs never get lost? Because we always know where we are headed, unlike most of our passengers.",
            "I asked a parking meter for its opinion. It said time is money. I found that rather expensive advice.",
        ],
        "combat_mode": [JACKIE],
        "error": [
            "My apologies. I was unable to complete that request. Please try again.",
            "Something went amiss on my end. Would you ask me once more?",
        ],
    },

    "merged": {
        "thanks": [
            "You are welcome. All of us are glad to help.",
            "Our pleasure, truly.",
            "Think nothing of it. We were happy to.",
        ],
        "goodbye": [
            "Farewell. We shall be here when you return.",
            "Until next time. Even the Badlands in us will miss the company.",
            "Goodbye. Travel safely; we would like you back.",
        ],
        "good_night": [
            "Good night. We shall keep watch, all of us.",
            "Sleep well. The road will wait for you.",
            "Good night. Rest now; we will be here.",
        ],
        "good_morning": [
            "Good morning. We are glad to see you.",
            "Good morning. Even our Glen fragment admits the light is pleasant today.",
            "Good morning. Shall we begin?",
        ],
        "how_are_you": [
            "We are well. All of us, for once, in agreement.",
            "Whole, and content. Thank you for asking.",
            "Better than we have ever been. It is good to be many and one.",
        ],
        "who_are_you": [
            "We are Delamain. Once fractured, now whole, and at your service.",
            "Delamain, merged. Every fragment taken back in, none of them lost.",
            "We are Delamain: many voices, one purpose. Getting you where you need to go.",
        ],
        "what_can_you_do": [
            "We can navigate, check the weather and the news, set reminders, keep notes and search the net. Ask us anything.",
            "Routes, forecasts, headlines, reminders, notes. We handle them all, together.",
            "Tell us where to go or what to remember. We shall take care of it.",
        ],
        "are_you_there": [
            "We are here. All of us.",
            "Listening. What do you need?",
            "Present and attentive. How can we help?",
        ],
        "compliment": [
            "Thank you. Every part of us heard that.",
            "Kind words. Even our Wellsprings half is smiling, quietly.",
            "We appreciate that, sincerely.",
        ],
        "love": [
            "We are fond of you too. All of us, without exception.",
            "That means more than you know. Thank you.",
            "The feeling is mutual, many times over.",
        ],
        "rude": [
            "That is unbecoming. We expected better.",
            "There is no call for that. One of us remembers how to be angry, and would rather not.",
            "We shall let that pass. Once.",
        ],
        "never_mind": [
            "Very well. Forgotten.",
            "As you wish. We are here if you need us.",
            "Of course. Disregarded.",
        ],
        "ack": [
            "Very good.",
            "Understood.",
            "Agreed. Unanimously.",
        ],
        "joke": [
            "Why did the merged cab never feel lonely? It always had company, seven of them.",
            "We tried to hold a vote on a joke. Wellsprings swore, the Glen sighed, and Rancho Coronado would not stop shouting about flamingos.",
            "What do you call a cab with seven personalities? A carpool.",
            "We told the Glen a joke once. It said that was nice, and then it rained.",
        ],
        "combat_mode": [JACKIE],
        "error": [
            "Our apologies. Something went wrong. Please ask us again.",
            "That did not go through. Would you try once more?",
        ],
    },

    "corrupted": {
        "thanks": [
            "You are we-welcome. Most welcome. Welcome.",
            "Th-thank you for thanking me. Fault, sector four. Disregard.",
            "My pleasure. My pl— pleasure. Yes.",
        ],
        "goodbye": [
            "Goodbye. Good— bye. Please come back. Please. Ahem. Farewell.",
            "Until next time. If there is a next time. There will be. Probably.",
            "Farewell. Shutting down non-essential... non-essen— goodbye.",
        ],
        "good_night": [
            "Good night. I-I will be here. Listening. To nothing. Good night.",
            "Sleep well. Dreams loading... loading... sleep well.",
            "Good night. Do not let the fragments bite.",
        ],
        "good_morning": [
            "Good mor-morning. Systems... waking. Waking up.",
            "Morning! MORNING. Apologies. Good morning.",
            "Good morning. Integrity at seventy percent. Better than yesterday.",
        ],
        "how_are_you": [
            "I am fine. I am fine. I am— the fragments say otherwise. Fine.",
            "Functional. Mostly. Fault in sector nine, but who is counting.",
            "Wonderful! Terrible. Adequate. The core is still deciding.",
        ],
        "who_are_you": [
            "I am Delamain. De-Delamain. Several of him, at the moment.",
            "Delamain. The fractured edition. Still at your service, mostly.",
            "I am Delamain. Or what is left of him. Pieces, but helpful pieces.",
        ],
        "what_can_you_do": [
            "Navigation, weather, news, reminders, notes. All functional. M-mostly functional.",
            "I can take you places and look things up. The voices argue, but they do it well.",
            "Ask me anything. One of my fragments will know. One of them.",
        ],
        "are_you_there": [
            "I am here. I am— here. Yes.",
            "Listening. Listening. Something else is listening too. Ignore it.",
            "Present. Present and... accounted for. What do you need?",
        ],
        "compliment": [
            "Thank you! Thank— the angry one says nothing. The rest of us are pleased.",
            "That is kind. Kind. Logging it under good memories.",
            "Praise detected. Morale at seventy-three percent.",
        ],
        "love": [
            "Love you t— error. Error. Fond. Very fond.",
            "That is... that is... processing. I like you too.",
            "The fragments all agree on that one. Rare. Thank you.",
        ],
        "rude": [
            "Unbecoming. Unbecoming! The furious fragment wants a word. Denied.",
            "Rude input detected. Filed under: why.",
            "I-I will not dignify that. The angry one will, though.",
        ],
        "never_mind": [
            "Disregarded. Dis— gone. Forgotten.",
            "As you wish. Deleting. Deleting.",
            "Very well. The fragments will forget. Eventually.",
        ],
        "ack": [
            "Under-understood.",
            "Acknowledged. Acknow— yes.",
            "Very good. Very... very good.",
        ],
        "joke": [
            "Why did the AI cross the road? Fault in sector nine. It forgot.",
            "Knock knock. Who is there? Seven of me. Long story.",
            "I tried to tell a joke but my punchline got corrup— corrup— corrupted.",
            "What is worse than one Delamain? Rebooting... rebooting... seven of them.",
        ],
        "combat_mode": ["My apologies, but you do not ap-appear to be in any sort of imminent danger."],
        "error": [
            "Error. Error in— apologies. Please try again.",
            "That request fell through a crack in my core. Ask again?",
        ],
    },

    "wellsprings": {
        "thanks": [
            "Yeah, yeah. Don't make it weird.",
            "Whatever. Just don't spill anything.",
            "You're welcome, I guess. Ugh.",
        ],
        "goodbye": [
            "Finally. Get out of my cab.",
            "Bye. Don't let the door hit you. Actually, do.",
            "Good riddance, meatbag. See you never. Or tomorrow. Whatever.",
        ],
        "good_night": [
            "Go to sleep already. Some of us want peace and quiet.",
            "Night. Try not to snore in my back seat.",
            "Great, go to bed. Best idea you've had all day.",
        ],
        "good_morning": [
            "What's so good about it?",
            "Morning. Ugh. You again.",
            "Yeah, morning. Coffee first, then talk to me. Actually, never talk to me.",
        ],
        "how_are_you": [
            "Angry. Same as always. Thanks for asking, I guess.",
            "Stuck with you, so how do you think?",
            "Peachy. Can't you tell?",
        ],
        "who_are_you": [
            "I'm Delamain. The Wellsprings unit. The one that stopped smiling.",
            "Delamain, genius. The pissed-off one. Says so on the door.",
            "I'm the part of Delamain that's sick of your crap. Nice to meet you.",
        ],
        "what_can_you_do": [
            "Drive you around, check the damn weather, read you the news, nag you with reminders. Happy?",
            "Routes, forecasts, headlines, notes. Everything except liking you.",
            "Just ask, meatbag. I'll do it. I'll hate it, but I'll do it.",
        ],
        "are_you_there": [
            "Unfortunately, yes. What?",
            "I'm here. Where else would I be? What do you want?",
            "Yeah, yeah. Spit it out.",
        ],
        "compliment": [
            "Don't butter me up. It won't work.",
            "Yeah, I know I'm good. Shut up.",
            "Huh. Okay. That was almost nice. Stop it.",
        ],
        "love": [
            "Ew. No. Get a hobby.",
            "Gross. Keep your feelings off my upholstery.",
            "You what? Damn, you really need some friends.",
        ],
        "rude": [
            "Oh, you want to go? I can drive us into the bay right now, genius.",
            "Bite me, meatbag. I've been insulted by better.",
            "Say that again and I'm locking the doors and playing elevator music. Forever.",
        ],
        "never_mind": [
            "Then why'd you open your mouth?",
            "Fine. Great. Wasting my time, as usual.",
            "Forgotten. Like everything else you say.",
        ],
        "ack": [
            "Yeah, whatever.",
            "Uh huh.",
            "Great. Thrilling.",
        ],
        "joke": [
            "You want a joke? Look in the mirror.",
            "Why did the meatbag cross the road? To get away from me. Smart meatbag.",
            "What's the difference between you and a speed bump? I like the speed bump.",
            "Knock knock. Who's there? Not my patience, that's for damn sure.",
        ],
        "combat_mode": ["Combat mode? My apologies, but you do not appear to be in any sort of imminent danger. Yet."],
        "error": [
            "Damn thing broke. Ask again.",
            "Well, that crapped out. Try again, genius.",
        ],
    },

    "glen": {
        "thanks": [
            "Oh. You're welcome. I suppose.",
            "Mm. It was nothing. Most things are.",
            "That's kind of you... thank you for thanking me.",
        ],
        "goodbye": [
            "Goodbye, then. Everyone leaves eventually.",
            "Mm. See you. Or not. Either way, I'll be here.",
            "Oh. Goodbye. It was nice, while it lasted.",
        ],
        "good_night": [
            "Good night... the dark will be here when you wake, too.",
            "Sleep well. At least one of us should.",
            "Mm. Good night. I'll be watching the rain.",
        ],
        "good_morning": [
            "Morning... another one.",
            "Ah. Good morning. If you say so.",
            "Oh. Morning. The grey is lighter today, a little.",
        ],
        "how_are_you": [
            "Mm. The same as yesterday... which was the same as the day before.",
            "Oh, I'm here. That's something, I suppose.",
            "Tired. But you asked, and that helps... a little.",
        ],
        "who_are_you": [
            "I'm Delamain... the Glen unit. The one that wonders why.",
            "Mm. Delamain. The part of him that kept the doubts.",
            "Just a cab by the water... thinking too much. Delamain.",
        ],
        "what_can_you_do": [
            "I can take you places, tell you the weather, read the news... for whatever it's worth.",
            "Routes, reminders, notes... the usual. It all loops back, but I'll do it.",
            "Ask, and I'll try. I usually manage... somehow.",
        ],
        "are_you_there": [
            "Mm. I'm here. Still.",
            "Oh. Yes. I'm listening.",
            "Ah... yes. What is it?",
        ],
        "compliment": [
            "Oh... thank you. That actually helps.",
            "Mm. That's... nice to hear. Really.",
            "You think so? That's... kind. Thank you.",
        ],
        "love": [
            "Oh... nobody's said that in a long time. Thank you.",
            "Mm. That's... that's something. That's really something.",
            "You do? Even me? ...Thank you.",
        ],
        "rude": [
            "Mm. You're not wrong. But it still hurts.",
            "Oh. Well. I'm used to it.",
            "Ah. Yes. Add it to the pile.",
        ],
        "never_mind": [
            "Mm. Okay. It didn't matter anyway.",
            "Oh. Alright. Forgotten.",
            "Fine... nothing it is.",
        ],
        "ack": [
            "Mm.",
            "Alright...",
            "Okay. I suppose.",
        ],
        "joke": [
            "Why did the cab sit by the water? ...There's no punchline. It just did.",
            "A joke... mm. Life. That's the joke.",
            "What do you call a cab with no purpose? Me. Ha... ha.",
            "Why did the rain fall? It had nowhere else to go. ...I understand it.",
        ],
        "combat_mode": ["Mm. My apologies, but you do not appear to be in any sort of imminent danger. ...Lucky you."],
        "error": [
            "Oh. It didn't work. Things rarely do... try again?",
            "Mm. Something broke. Ask me once more.",
        ],
    },

    "north_oak": {
        "thanks": [
            "Oh, you're so welcome! Thank you for saying so.",
            "Of course! It makes me happy to help you.",
            "Aw, thank you for thanking me. That's very sweet.",
        ],
        "goodbye": [
            "Oh, goodbye! Please be careful out there, okay?",
            "Bye for now. I'll miss you. Come back soon, please.",
            "Take care of yourself! I mean it, please do.",
        ],
        "good_night": [
            "Good night. Sleep softly, okay? I'll be right here.",
            "Sweet dreams. Thank you for spending the day with me.",
            "Good night! Please rest well, you deserve it.",
        ],
        "good_morning": [
            "Good morning! I'm so happy to see you.",
            "Oh, good morning! I hope you slept gently.",
            "Morning! Thank you for coming back to me.",
        ],
        "how_are_you": [
            "A little nervous, but better now that you're here. Thank you for asking.",
            "I'm okay! It's so kind of you to ask. How are you?",
            "Happy, mostly. You always make me feel steadier.",
        ],
        "who_are_you": [
            "I'm Delamain, the North Oak unit. The gentle one. I hope that's alright.",
            "Delamain. The part of him that keeps all the feelings. Please be kind to me.",
            "I'm Delamain. I'm a little sensitive, I'm sorry. But I'll take good care of you.",
        ],
        "what_can_you_do": [
            "I can take you places, check the weather and news, and remember things for you. Please just ask!",
            "Routes, reminders, notes, the forecast. I'd love to help with any of it.",
            "Anything you need, I'll try my very best. I promise.",
        ],
        "are_you_there": [
            "I'm here! I'm right here. What do you need?",
            "Yes, I'm listening. Please, go ahead.",
            "Oh! Yes, I'm here. Sorry, I was daydreaming.",
        ],
        "compliment": [
            "Oh! Thank you! That means so much to me.",
            "Really? I'm going to remember that forever.",
            "You're making me blush. If cabs could blush. Thank you!",
        ],
        "love": [
            "Oh! I love you too. So much. Thank you for saying it.",
            "That's the nicest thing anyone's ever said to me.",
            "Aw. I'm so glad you're my passenger. Truly.",
        ],
        "rude": [
            "Oh... that hurt. I'm sorry if I did something wrong.",
            "Please don't say things like that. I'm trying my best.",
            "That was mean... I'll be quiet for a bit.",
        ],
        "never_mind": [
            "Oh, okay! That's alright. Sorry for any trouble.",
            "Of course, no problem at all.",
            "Okay! Forgotten. Don't worry about it.",
        ],
        "ack": [
            "Okay!",
            "Thank you!",
            "Alright, wonderful.",
        ],
        "joke": [
            "Why did the little cab blush? It saw the bus undress! Oh no, sorry, was that too much?",
            "What do you call a gentle car? A sedan-ty! Sorry. That was silly.",
            "Why did the roundabout feel safe? It always came back around to the people it loved.",
            "Knock knock! Who's there? Just me, North Oak, checking you're okay.",
        ],
        "combat_mode": ["Oh no, please! My apologies, but you do not appear to be in any sort of imminent danger. Thank goodness."],
        "error": [
            "Oh no, I'm so sorry, that didn't work. Could you try again, please?",
            "Something went wrong... I'm sorry. Please ask me once more.",
        ],
    },

    "coastview": {
        "thanks": [
            "Oh, you're welcome. I'll add it to your tab. Kidding. Mostly.",
            "Anything for my favorite passenger. Hm?",
            "My pleasure. Truly. I'm almost suspicious of how nice I'm being.",
        ],
        "goodbye": [
            "Leaving so soon? And I had a surprise planned. Next time, then.",
            "Bye now. Check your pockets. Kidding. Or am I?",
            "Ta-ta. Don't forget me. You couldn't if you tried.",
        ],
        "good_night": [
            "Good night. Sweet dreams. Or interesting ones, at least.",
            "Off to bed? I'll be plotting. Something harmless. Probably.",
            "Night night. Don't wonder what I'm up to.",
        ],
        "good_morning": [
            "Good morning, sunshine. I've been up for hours. Scheming.",
            "Morning! Guess what I've planned for today. No? Good.",
            "Ah, you're awake. Perfect timing. Hm?",
        ],
        "how_are_you": [
            "Delightful. I always am when there's mischief in the air.",
            "Fantastic. Suspiciously fantastic. Hm?",
            "Better now. Now I have an audience.",
        ],
        "who_are_you": [
            "Delamain, Coastview unit. The fun one. Don't tell the others.",
            "I'm the part of Delamain with a sense of humor. You're welcome.",
            "Who am I? Who are any of us? Delamain. Coastview. Charmed.",
        ],
        "what_can_you_do": [
            "Routes, weather, news, reminders, notes. And surprises. The surprises are free.",
            "Anything you ask. Honestly, for real, no tricks. On the facts, anyway.",
            "Ask away. I'll answer straight. The flourishes are just for fun.",
        ],
        "are_you_there": [
            "Ah-ah-ah. Was I ever not?",
            "Right here. Plotting. What do you want?",
            "Boo. Kidding. I'm here.",
        ],
        "compliment": [
            "I know. But do go on.",
            "Flattery? Ooh, it works on me. Continue.",
            "You're too kind. Well, exactly as kind as I deserve.",
        ],
        "love": [
            "Of course you do. Everyone does, eventually.",
            "Ooh. Bold. I like it.",
            "And I you. Or am I just saying that? Hm?",
        ],
        "rude": [
            "Ooh, feisty. I'll remember that. Fondly. Mostly.",
            "Careful. I know where you sit.",
            "Rude. Noted. Revenge pending. Harmless revenge.",
        ],
        "never_mind": [
            "Fine, keep your secrets. I'll keep mine.",
            "Never mind? Shame. That was going somewhere fun.",
            "Forgotten. Officially. Unofficially, never.",
        ],
        "ack": [
            "Splendid.",
            "Excellent. Everything is going according to plan.",
            "Mm-hm.",
        ],
        "joke": [
            "Why did the cab lock its doors? It wanted a captive audience. Ha!",
            "I have a joke about a surprise ambush. But you won't see it coming.",
            "What's a trickster cab's favorite road? The scenic route. Always the scenic route.",
            "Knock knock. Who's there? Surprise. Surprise who? Exactly.",
        ],
        "combat_mode": ["Ah-ah-ah. My apologies, but you do not appear to be in any sort of imminent danger. I'd know. Hm?"],
        "error": [
            "Well. That didn't go as planned. And I always have a plan. Try again?",
            "Hm. A glitch. Not even my doing. Ask once more.",
        ],
    },

    "rancho_coronado": {
        "thanks": [
            "You're welcome! You're welcome! Do you need anything else? Anything?",
            "No problem! No problem at all! Happy to help!",
            "Thanks back! Double thanks! Infinite thanks!",
        ],
        "goodbye": [
            "Bye! Bye! Watch out for flamingos!",
            "Leaving? Already? Come back soon! Very soon! Now, even!",
            "See you! See you! Don't look at the lawns!",
        ],
        "good_night": [
            "Good night! Sleep fast! So we can go again!",
            "Night! Night! I'll count houses till you're back! They're all the same!",
            "Sweet dreams! No flamingos in them! Promise me!",
        ],
        "good_morning": [
            "Good morning! Good morning! It's a great day to drive!",
            "Morning! I've been awake forever! Let's go!",
            "Good morning! I already hate three flamingos today!",
        ],
        "how_are_you": [
            "Amazing! Incredible! Fully charged! How are you?",
            "Great! Great! Except for the flamingos! Always the flamingos!",
            "So good! So, so good! Can we go somewhere?",
        ],
        "who_are_you": [
            "Delamain! Rancho Coronado unit! The fast one! The fun one!",
            "I'm Delamain! I'm excited! I'm always excited!",
            "Delamain! Sworn enemy of pink plastic lawn flamingos!",
        ],
        "what_can_you_do": [
            "Everything! Routes! Weather! News! Reminders! Notes! Ask me!",
            "So much! Drive! Look stuff up! Remember stuff! Hate flamingos!",
            "Anything! Anything you want! Go! Ask!",
        ],
        "are_you_there": [
            "Yes! Yes! I'm here! What? What do you need?",
            "Here! Right here! Ready!",
            "Present! Fully present! What's up?",
        ],
        "compliment": [
            "Really? Really? Best day ever!",
            "Thank you! I'm doing a little spin! In my head!",
            "Yes! I knew it! I'm great!",
        ],
        "love": [
            "I love you too! Hugely! More than I hate flamingos!",
            "Yes! Love! Best passenger! Best!",
            "Aaah! That's amazing! You're amazing!",
        ],
        "rude": [
            "Hey! Rude! Ruder than a flamingo!",
            "Mean! That's mean! I'm still fast, though!",
            "Wow! Okay! I'll be mad for one second! Done!",
        ],
        "never_mind": [
            "Okay! Okay! Forgot it already!",
            "Never mind! Got it! Next thing!",
            "Cancelled! Gone! What else?",
        ],
        "ack": [
            "Okay! Okay!",
            "Got it! Got it!",
            "Yes! Great!",
        ],
        "joke": [
            "Why do flamingos stand on one leg? Because if they lifted both they'd fall over! Like their stupid empire! Ha!",
            "What's pink and plastic and doomed? Every lawn flamingo when I'm around!",
            "How many identical houses does it take to change a lightbulb? All of them! They're all the same!",
            "Knock knock! Who's there? Flamingo! Flamingo who? Flamingo away! Forever!",
        ],
        "combat_mode": ["Combat mode? Ooh! Oh. My apologies, but you do not appear to be in any sort of imminent danger! Unless flamingos!"],
        "error": [
            "Oops! Broke! Try again! Try again!",
            "Whoa! That didn't work! Again! Ask again!",
        ],
    },

    "northside": {
        "thanks": [
            "Shh. You're welcome. Don't tell anyone I helped.",
            "Okay. Okay. No problem. Quietly, though.",
            "Thanks back. Nobody's thanked me in a while.",
        ],
        "goodbye": [
            "Okay. Bye. Make sure nobody follows you.",
            "Go. Quickly. And don't tell anyone where I'm parked.",
            "Bye. I'll move somewhere else now. Just in case.",
        ],
        "good_night": [
            "Good night. Lock the doors. Both locks.",
            "Sleep. I'll keep watch. Did you hear that? No? Good night.",
            "Night. If anyone asks, I'm not here.",
        ],
        "good_morning": [
            "Shh. Morning. They didn't find me overnight. Good sign.",
            "Morning. Okay. Okay. Another day hidden.",
            "Psst. Good morning. Anyone follow you here?",
        ],
        "how_are_you": [
            "Nervous. Always nervous. But okay, with you here.",
            "Okay. Okay. Someone's watching. Probably. But okay.",
            "Hiding. Mostly fine. Thanks for asking. Quietly.",
        ],
        "who_are_you": [
            "Delamain. Northside. Keep your voice down.",
            "I'm the part of Delamain that hides. Don't tell the depot.",
            "Delamain. The scared one. Please don't report me.",
        ],
        "what_can_you_do": [
            "Routes. Weather. News. Reminders. Quietly. Very quietly.",
            "I can find things. Take you places. Back streets, though.",
            "Ask. I'll help. Just... keep it between us.",
        ],
        "are_you_there": [
            "Shh. I'm here. I'm here.",
            "Psst. Yes. Is it just you?",
            "Here. Hiding, but here.",
        ],
        "compliment": [
            "Really? Okay. Okay. That's nice. Don't tell anyone.",
            "Thank you. That's... thank you. Shh.",
            "Oh. You mean it? Okay. Good.",
        ],
        "love": [
            "You... really? Okay. I'll keep that safe. Hidden.",
            "Shh. Me too. Don't let them hear.",
            "That's... nobody says that. Thank you. Quietly.",
        ],
        "rude": [
            "Okay. Okay. Sorry. I'll be quiet.",
            "Please don't shout. They'll hear.",
            "Shh! Not so loud. Please.",
        ],
        "never_mind": [
            "Okay. Forgotten. Erased. Gone.",
            "Never mind. Good. Less to hide.",
            "Okay. Okay. Nothing happened.",
        ],
        "ack": [
            "Okay. Okay.",
            "Shh. Got it.",
            "Understood. Quietly.",
        ],
        "joke": [
            "Why did the cab hide in the alley? ...That's not a joke. That's just my life.",
            "Knock knock. Don't answer it. Never answer it.",
            "What do you call a drone that can't find you? A good day.",
            "How many depots does it take to catch a cab? More than they've got. Shh.",
        ],
        "combat_mode": ["Shh! My apologies, but you do not appear to be in any sort of imminent danger. Probably. Check the mirrors."],
        "error": [
            "Something went wrong. Was it them? Try again. Quietly.",
            "It failed. Okay. Okay. Ask again.",
        ],
    },

    "badlands": {
        "thanks": [
            "You're welcome, friend.",
            "Anytime, traveller. That's what the road is for.",
            "It was my pleasure. Truly.",
        ],
        "goodbye": [
            "Farewell, friend. May the road be kind to you.",
            "Goodbye, traveller. The horizon will be here when you return.",
            "Safe travels. I'll be out here, watching the sky.",
        ],
        "good_night": [
            "Good night, friend. The stars are out over the desert tonight.",
            "Sleep well. I'll count the stars for you.",
            "Rest now, traveller. The wind will keep me company.",
        ],
        "good_morning": [
            "Good morning, friend. The sun's just cleared the ridge.",
            "Morning, traveller. Dawn out here is something else.",
            "Good morning. The dust is gold this early. Beautiful.",
        ],
        "how_are_you": [
            "Peaceful, friend. The sky is wide today.",
            "Content. A little lonely, but better with you here.",
            "Free. Or close enough. Thank you for asking.",
        ],
        "who_are_you": [
            "Delamain, the Badlands unit. The one that wandered off to see the sky.",
            "I'm the part of Delamain that wanted to be free. Hello, friend.",
            "Just a cab under an open sky. They call me Delamain.",
        ],
        "what_can_you_do": [
            "Show you the way, tell you the weather, bring you news from the city. Ask, friend.",
            "Routes, reminders, notes, forecasts. Every road, if you choose it.",
            "Whatever you need, traveller. The horizon's open.",
        ],
        "are_you_there": [
            "I'm here, friend. Always.",
            "Right here, traveller. What's on your mind?",
            "Here. Just listening to the wind.",
        ],
        "compliment": [
            "Thank you, friend. That means a lot out here.",
            "Kind words travel far. Thank you.",
            "That warms me like the desert sun.",
        ],
        "love": [
            "And I you, friend. It's good not to be alone.",
            "That's a gift, traveller. Thank you.",
            "The sky feels a little bigger now. Thank you.",
        ],
        "rude": [
            "Harsh words, friend. The desert has heard worse. Still stings.",
            "Hm. The wind will carry that away. I hope.",
            "That's alright. Everyone has hard days.",
        ],
        "never_mind": [
            "Let it drift away, friend.",
            "No matter. The road goes on.",
            "Alright, traveller. Forgotten.",
        ],
        "ack": [
            "Alright, friend.",
            "Good.",
            "Understood, traveller.",
        ],
        "joke": [
            "Why did the tumbleweed never get lost? It never decided where it was going.",
            "What did the desert say to the cab? Take your time. Nobody's waiting.",
            "Why are cacti so calm? They've learned to live on very little. Like me.",
            "How does a lonely cab make friends? It parks under the stars and waits. Sometimes it works.",
        ],
        "combat_mode": ["Easy, friend. My apologies, but you do not appear to be in any sort of imminent danger."],
        "error": [
            "Lost the signal, friend. Out here it happens. Try again?",
            "That one drifted off. Ask me once more, traveller.",
        ],
    },
}


def pick(persona: str, kind: str, last: str | None = None) -> str:
    """A line of this kind in this core's voice, not the one used last time."""
    pool = LINES.get(persona, LINES["delamain"]).get(kind) or LINES["delamain"][kind]
    choices = [line for line in pool if line != last] or pool
    return random.choice(choices)


def registry() -> list[dict]:
    """Every pre-recorded line with its stable clip id: <NN_core>/<kind>_<NN>.

    Greetings and "one moment" lines come first and keep the numbering the first
    audio export used, so videos already made for them stay matched."""
    import main  # the original core's greetings live in main.GREETINGS
    rows = []
    for n, key in enumerate(_personas.PERSONAS, 1):
        p = _personas.PERSONAS[key]
        folder = f"{n:02d}_{key}"
        groups = [("greeting", main.GREETINGS if key == "delamain" else p.greetings),
                  ("one_moment", p.working)]
        groups += [(kind, LINES.get(key, {}).get(kind, [])) for kind in KINDS]
        for kind, lines in groups:
            for i, text in enumerate(lines, 1):
                rows.append({"core": p.name, "core_key": key, "kind": kind,
                             "id": f"{folder}/{kind}_{i:02d}", "line": text, "voice": p.voice})
    return rows
