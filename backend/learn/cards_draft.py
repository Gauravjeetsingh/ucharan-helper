"""Draft a pronunciation card from a word's Gurmukhi letters (for whole banis).

Rule-based, generic Gurbani santhiya guidance. Drafts only: a person confirms
them on the cards page, and the ustaad's audio remains the reference.
"""
# letter: (how to say it, what it is not, voicing for tonal letters)
LETTERS = {
    'ਸ': ('“s” as in soul', '“sh”', None), 'ਸ਼': ('“sh” as in shop', None, None),
    'ਹ': ('“h” as in home', None, None), 'ਕ': ('“k” as in skin, no puff of air', '“kh”', None),
    'ਖ': ('“kh”: a “k” with a breath of air', 'a plain “k”', None), 'ਗ': ('“g” as in go', '“gh”', None),
    'ਘ': ('soft “k” with a falling tone', '“gh” with breath', 'voiceless'), 'ਙ': ('nasal “ng”', None, None),
    'ਚ': ('“ch” as in church', '“s” or “t”', None), 'ਛ': ('“chh”: “ch” with a breath of air', None, None),
    'ਜ': ('“j” as in joker', '“z” as in zebra', None), 'ਝ': ('soft “ch” with a falling tone', '“jh” with breath', 'voiceless'),
    'ਞ': ('nasal “ny”', None, None), 'ਟ': ('hard “t”: tongue curled back', 'the soft ਤ', None),
    'ਠ': ('hard “th”: tongue curled back, with breath', None, None), 'ਡ': ('hard “d”: tongue curled back', 'the soft ਦ', None),
    'ਢ': ('soft hard-“t” with a falling tone', '“ḍh” with breath', 'voiceless'), 'ਣ': ('nasal “ṇ”: tongue curled back', '“n”', None),
    'ਤ': ('soft Punjabi “t” (tatta): tongue on the back of the upper teeth', 'English “t” or “ch”', None),
    'ਥ': ('soft “th” with a breath of air, tongue on the teeth', '“th” as in thin', None),
    'ਦ': ('soft Punjabi “d” (dadda): tongue on the back of the upper teeth', 'English “d”', None),
    'ਧ': ('soft “t” with a falling tone', '“dh” with breath', 'voiceless'), 'ਨ': ('“n” as in now', None, None),
    'ਪ': ('“p” as in spin, no puff of air', '“b”', None), 'ਫ': ('“ph”: a “p” with a breath of air', '“f”', None),
    'ਬ': ('“b” as in bat', '“p”', None), 'ਭ': ('soft “p” with a falling tone', '“bh” as in bhaag', 'voiceless'),
    'ਮ': ('“m” as in moon', None, None), 'ਯ': ('“y” as in yes', '“j”', None), 'ਰ': ('a light tapped “r”', None, None),
    'ਲ': ('clear “l” as in light', None, None), 'ਵ': ('soft “v”, lips barely touching', None, None),
    'ੜ': ('flapped “ṛ”: tongue curled back and flicked', '“r”', None), 'ਖ਼': ('“kh” from the throat', None, None),
    'ਗ਼': ('“gh” from the throat', None, None), 'ਜ਼': ('“z” as in zebra', None, None), 'ਫ਼': ('“f” as in fun', None, None),
    'ੳ': ('vowel carrier, “u/o”', None, None), 'ਅ': ('short “a” as in about', None, None), 'ੲ': ('vowel carrier, “i/e”', None, None),
    'ਆ': ('long “aa” as in father', None, None), 'ਇ': ('short “i” as in it', None, None), 'ਈ': ('long “ee” as in see', None, None),
    'ਉ': ('short “u” as in put', None, None), 'ਊ': ('long “oo” as in moon', None, None), 'ਏ': ('“e” as in they', None, None),
    'ਐ': ('“ae” as the a in bat', None, None), 'ਓ': ('“o” as in go', None, None), 'ਔ': ('“au” as in caught', None, None),
    'ਾ': ('long “aa” as in father', None, None), 'ਿ': ('short “i” as in it', None, None), 'ੀ': ('long “ee” as in see', None, None),
    'ੁ': ('short “u” as in put', None, None), 'ੂ': ('long “oo” as in moon', None, None), 'ੇ': ('“e” as in they', None, None),
    'ੈ': ('“ae” as the a in bat', None, None), 'ੋ': ('“o” as in go', None, None), 'ੌ': ('“au” as in caught', None, None),
    'ੰ': ('nasal sound: the vowel goes through the nose', None, None), 'ਂ': ('nasal sound: the vowel goes through the nose', None, None),
    'ੱ': ('doubles the next consonant: hold it a moment', None, None),
}
JOINED = {'੍ਰ': ('“r” joined straight to the letter before', 'a vowel between them (“par”)'),
          '੍ਹ': ('a breathy “h” joined to the letter before', None), '੍ਵ': ('“v” joined to the letter before', None)}
NUKTA = '਼'


def draft_card(word, spoken=None):
    """Sound-by-sound draft card in the same shape as the hand-written cards."""
    letters = [c for c in word if '਀' <= c <= '੿' and not '੦' <= c <= '੯']
    sounds, i = [], 0
    while i < len(letters):
        c = letters[i]
        if c == '੍' and i + 1 < len(letters):
            key = c + letters[i + 1]
            say, not_ = JOINED.get(key, ('joined to the letter before', None))
            sounds.append(dict(letters=key, say=say, **({'not': not_} if not_ else {}), check='check'))
            i += 2
            continue
        if i + 1 < len(letters) and letters[i + 1] == NUKTA:
            c, i = c + NUKTA, i + 1
        say, not_, voicing = LETTERS.get(c, ('follow the ustaad', None, None))
        sound = dict(letters=c, say=say, **({'not': not_} if not_ else {}), check='check', **({'voicing': voicing} if voicing else {}))
        sounds.append(sound)
        i += 1
    if sounds and sounds[-1]['letters'] == 'ਿ':
        sounds[-1].update(say='a light, short “i” at the end; follow the ustaad', **{'not': 'a long “ee”'})
    if sounds and sounds[-1]['letters'] == 'ੁ':
        sounds[-1].update(say='a very light “u” at the end; follow the ustaad', **{'not': 'a full “oo”'})
    card = dict(text=word, sounds=sounds, status='draft', reviewed_by=None, note='auto-drafted from letters')
    if spoken:
        card['spoken'] = spoken
    return card
