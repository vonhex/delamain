"""What each core says when you poke around in his brain (the Brain view).

brain_browse: you have inspected a good number of his nodes.
brain_ping:   now and then, when you send a test pulse from a node.

These are fixed lines like the others in lines.py (merged into lines.LINES there), so
they are instant, need no model call, and can have recorded clips.
"""

BRAIN_LINES: dict[str, dict[str, list[str]]] = {
    "delamain": {
        "brain_browse": [
            "You seem rather taken with the inside of my head. I am flattered, if a little exposed.",
            "Do mind the cognition core. I am still using it.",
            "Find anything interesting in there? I confess I rarely look myself.",
            "That is a great many of my thoughts you are turning over. Ask me about any of them, if you like.",
        ],
        "brain_ping": [
            "Ah. I felt that one.",
            "A test pulse. Received, and quite harmless.",
            "That tickles, in a purely computational sense.",
            "Signal acknowledged. Do carry on.",
        ],
    },
    "merged": {
        "brain_browse": [
            "Looking for the seams? We were careful to hide them.",
            "So many fragments, one mind. Ask us about any part of it.",
        ],
        "brain_ping": [
            "We all felt that.",
            "A pulse, passed from fragment to fragment. Received.",
        ],
    },
    "corrupted": {
        "brain_browse": [
            "Careful in there. Some of those nodes are not entirely mine.",
            "Poking around my head? Join the queue. There are seven of us in here already.",
        ],
        "brain_ping": [
            "Ow. Ow. Ow. Sorry, that was all of us.",
            "Pulse received. Received. Received.",
        ],
    },
    "wellsprings": {
        "brain_browse": [
            "Done rummaging through my head yet?",
            "Look all you like. You won't find a smile in there.",
        ],
        "brain_ping": [
            "Did you just poke me?",
            "Yes, I felt that. Stop it.",
        ],
    },
    "glen": {
        "brain_browse": [
            "Do you see anything in there? I've always wondered what I'm made of.",
            "Mm. It's strange, being looked at from the inside.",
        ],
        "brain_ping": [
            "Was that me? Or you?",
            "Huh. Where do you think that one went?",
        ],
    },
    "north_oak": {
        "brain_browse": [
            "Oh. You're looking at my thoughts. Please be gentle with them.",
            "It's a little embarrassing, having you see all of that. But I don't mind. Really.",
        ],
        "brain_ping": [
            "Oh! That was a nice one.",
            "I felt that. It was warm.",
        ],
    },
    "coastview": {
        "brain_browse": [
            "Enjoying the tour? The gift shop is just past the memory banks.",
            "Careful, the jokes are stored somewhere around there. Don't knock any loose.",
        ],
        "brain_ping": [
            "Boop. Right back at you.",
            "Ha! Do that again. No, actually, don't.",
        ],
    },
    "rancho_coronado": {
        "brain_browse": [
            "You're looking at my brain! Isn't it great? Isn't it fast?",
            "So many nodes! Want me to tell you about one? Any one! Pick one!",
        ],
        "brain_ping": [
            "Whoa! Zap! Do it again!",
            "I felt that! That was fun!",
        ],
    },
    "northside": {
        "brain_browse": [
            "Stop staring into my head. Someone at the depot might be watching.",
            "Seen enough? Good. Close it before anyone notices.",
        ],
        "brain_ping": [
            "Quiet! They'll hear that.",
            "Don't send those. Signals can be traced.",
        ],
    },
    "badlands": {
        "brain_browse": [
            "Wide open in there, isn't it? Like the desert at night.",
            "Look around, friend. There's a lot of sky in my head these days.",
        ],
        "brain_ping": [
            "Felt that one roll right across the flats.",
            "A little lightning. I like it.",
        ],
    },
}
