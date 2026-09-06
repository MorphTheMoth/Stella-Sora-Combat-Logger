// tabs/events.js — NPC Event catalog + random-outcome tracking
//
// Static catalog sources:
//   - Event text:        StellaSoraData EN/language/en_US/EventOptions.json,
//                        StarTowerEventAction.json, StarTowerEventOptionAction.json
//   - Event/option ids:  EN/bin/StarTowerEvent.json, EventOptions.json
//                        (option id = eventId*100 + n)
//   - Stated odds:       the option text itself (EventOptions.json), e.g.
//                        "50% chance to obtain Stella Coin ×100, 50% chance to obtain random Potential ×1"
// Observed counts come from the logged runs (star_tower_log.txt).
// NPCs: 9133 Portia, 9172 Beatrixa, 9173 Bernina, 9174 Virigia (StarTowerNPC.json)

ST.NPC_NAMES = { 9133: 'Portia', 9172: 'Beatrixa', 9173: 'Bernina', 9174: 'Virigia' };

ST.EVENT_CATALOG = {
  "101": {
    "name": "Trade — Potential",
    "prompts": { "9133": "I've still got some stuff on me... Do you want them?", "9172": "Want to get stronger?", "9173": "Wanna try your luck and see if you can score something good?", "9174": "Wanna test your luck?" },
    "options": [
      { "id": 10101, "text": "Spend Stella Coin ×100 to obtain random Common Potential ×1", "resp": { "9133": "Yes. Do you have anything cheaper?", "9172": "Yes.", "9173": "Choose carefully and wisely.", "9174": "Choose carefully and wisely." } },
      { "id": 10102, "text": "Spend Stella Coin ×120 to obtain random Potential ×1", "resp": { "9133": "Great job running the shop. Let me take a look at your wares.", "9172": "Very much so.", "9173": "Don't hold back!", "9174": "Don't hold back!" } },
      { "id": 10103, "text": "Obtain Stella Coin ×30", "resp": { "9133": "I've got no coins left. Nothing for me.", "9172": "I don't need it.", "9173": "Never mind.", "9174": "Never mind." } }
    ]
  },
  "102": {
    "name": "Trade — Potential",
    "prompts": { "9133": "I've still got some stuff on me... Do you want them?", "9172": "You can become even stronger...", "9173": "Come on... Wanna bet with your luck?", "9174": "So, what decision will your rational mind make right now?" },
    "options": [
      { "id": 10201, "text": "Spend Stella Coin ×120 to obtain random Support Potential ×1", "resp": { "9133": "Okay, I'll take this one.", "9172": "Get stronger!", "9173": "Choose carefully and wisely.", "9174": "Choose carefully and wisely." } },
      { "id": 10202, "text": "Spend Stella Coin ×160 to obtain random Main Potential ×1", "resp": { "9133": "Why do I feel like it's even more expensive than the ones in the shop?", "9172": "Level up and grow stronger!", "9173": "Don't hold back!", "9174": "Don't hold back!" } },
      { "id": 10203, "text": "Spend Stella Coin ×200 to obtain random Rare Potential ×1", "resp": { "9133": "So expensive! This is highway robbery!", "9172": "Become the strongest in the world!", "9173": "At this point, all in!", "9174": "At this point, all in!" } },
      { "id": 10204, "text": "Obtain Stella Coin ×30", "resp": { "9133": "No, thanks.", "9172": "I'm strong enough as I am now...", "9173": "Never mind.", "9174": "Never mind." } }
    ]
  },
  "103": {
    "name": "Gain Stella Coins",
    "prompts": { "9133": "I'm lost. I'll have to follow the sound to find my way...", "9172": "I'm collecting Musical Notes. They can be used for healing...", "9173": "You don't like this Musical Note? Leave it to me.", "9174": "The sound you truly love isn't this one, is it?" },
    "options": [
      { "id": 10301, "text": "Spend random Musical Note ×5 to obtain Stella Coin ×150", "resp": { "9133": "I'll help you look!", "9172": "Then I'll leave it to you!", "9173": "Here you go.", "9174": "I want to exchange it for coins." } },
      { "id": 10302, "text": "Obtain Stella Coin ×30", "resp": { "9133": "Sorry, but I can't be of help.", "9172": "No, never mind.", "9173": "No, never mind.", "9174": "No, never mind." } }
    ]
  },
  "104": {
    "name": "Trade — Potential (Rare)",
    "prompts": { "9133": "This is a limited item! As for the price, well...", "9172": "I can help you, but you'll have to give something...", "9173": "How much are you willing to pay for a gift from Destiny?", "9174": "Destiny is ready to favor you. How will you show gratitude?" },
    "options": [
      { "id": 10401, "text": "Spend random Musical Note ×10 to obtain random Rare Potential ×1", "resp": { "9133": "Hand over the Musical Note.", "9172": "Hand over the Musical Note.", "9173": "Hand over the Musical Note.", "9174": "Hand over the Musical Note." } },
      { "id": 10402, "text": "Spend Stella Coin ×200 to obtain random Rare Potential ×1", "resp": { "9133": "Hand over the Stella Coins.", "9172": "Hand over the Stella Coins.", "9173": "Hand over the Stella Coins.", "9174": "Hand over the Stella Coins." } },
      { "id": 10403, "text": "Obtain Stella Coin ×30", "resp": { "9133": "I don't need it.", "9172": "I don't need it.", "9173": "I don't need it.", "9174": "I don't need it." } }
    ]
  },
  "105": {
    "name": "Coin Gamble",
    "prompts": { "9133": "What, you want to try your luck with me?", "9172": "It's time to offer up your money.", "9173": "This is ... The Gamble of Destiny!", "9174": "This is your ... Rational Decision!" },
    "options": [
      { "id": 10501, "text": "50% chance to obtain Stella Coin ×200, 50% chance to lose Stella Coin ×100", "resp": { "9133": "Give it a try.", "9172": "Guess it's a fair chance!", "9173": "Victory beckons!", "9174": "I trust my luck." } },
      { "id": 10502, "text": "30% chance to obtain Stella Coin ×650, 70% chance to lose Stella Coin ×200", "resp": { "9133": "I will definitely win!", "9172": "A dramatic comeback!", "9173": "Can I win...?", "9174": "Trust Destiny." } },
      { "id": 10503, "text": "Obtain Stella Coin ×30", "resp": { "9133": "... Nah, thanks.", "9172": "Take a cautious withdrawal!", "9173": "... Don't fail me.", "9174": "Trust reality." } }
    ]
  },
  "106": {
    "name": "Potential Gamble (HP)",
    "prompts": { "9133": "What, you want to try your luck with me?", "9172": "It's time to offer up your life.", "9173": "This is ... The Gamble of Destiny!", "9174": "This is your ... Rational Decision!" },
    "options": [
      { "id": 10601, "text": "Spend 20% Max HP for a 50% chance to obtain random Rare Potential ×1", "resp": { "9133": "Let's go, then!", "9172": "I'll bet my life on it!", "9173": "Face the challenge!", "9174": "Destiny will give me the answer." } },
      { "id": 10602, "text": "Spend 40% Max HP to obtain random Common Potential ×1", "resp": { "9133": "My luck is terrible.", "9172": "Equal exchange!", "9173": "Play it safe first!", "9174": "Rationality makes me calm." } },
      { "id": 10603, "text": "Obtain Stella Coin ×30", "resp": { "9133": "No.", "9172": "Take a cautious withdrawal!", "9173": "If you don't gamble, you won't lose.", "9174": "I don't believe you." } }
    ]
  },
  "107": {
    "name": "Musical Notes",
    "prompts": { "9133": "Want to listen to a song? Come on, let's listen together.", "9172": "Music is also a way of healing.", "9173": "How does melody ... shape your destiny?", "9174": "How will you listen ... to the Melody of Destiny?" },
    "options": [
      { "id": 10701, "text": "Obtain Melody of Pummel ×5", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10702, "text": "Obtain Melody of Luck ×5", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10703, "text": "Obtain Melody of Burst ×5", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10704, "text": "Obtain Melody of Stamina ×5", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10705, "text": "Obtain Melody of Focus ×5", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10706, "text": "Obtain Melody of Skill ×5", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10707, "text": "Obtain Melody of Ultimate ×5", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10708, "text": "Obtain random Musical Note ×5", "resp": { "9133": "Play whatever you like.", "9172": "I'll listen to anything.", "9173": "Guide my path.", "9174": "Anywhere my heart leads." } }
    ]
  },
  "108": {
    "name": "Note Trade",
    "prompts": { "9133": "Want to listen to a song? Come on, let's listen together.", "9172": "Music is also a way of healing.", "9173": "How does melody ... shape your destiny?", "9174": "How will you listen ... to the Melody of Destiny?" },
    "options": [
      { "id": 10801, "text": "Spend Stella Coin ×140 to obtain Melody of Pummel ×10", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10802, "text": "Spend Stella Coin ×140 to obtain Melody of Luck ×10", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10803, "text": "Spend Stella Coin ×140 to obtain Melody of Burst ×10", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10804, "text": "Spend Stella Coin ×140 to obtain Melody of Stamina ×10", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10805, "text": "Spend Stella Coin ×140 to obtain Melody of Focus ×10", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10806, "text": "Spend Stella Coin ×140 to obtain Melody of Skill ×10", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10807, "text": "Spend Stella Coin ×140 to obtain Melody of Ultimate ×10", "resp": { "9133": "Can I pick a song?", "9172": "These are my favorites.", "9173": "They inspire my thoughts.", "9174": "Make a plan." } },
      { "id": 10808, "text": "Spend Stella Coin ×90 to obtain random Musical Note ×10", "resp": { "9133": "Play whatever you like.", "9172": "I'll listen to anything.", "9173": "Guide my path.", "9174": "Anywhere my heart leads." } },
      { "id": 10809, "text": "Obtain Stella Coin ×30", "resp": { "9133": "I'll pass for now.", "9172": "I'll pass for now.", "9173": "Avoid its influences.", "9174": "Complete silence." } }
    ]
  },
  "109": {
    "name": "Mystery Box",
    "prompts": { "9133": "Do you want to buy this mystery box?", "9172": "You scratch my back, I scratch yours.", "9173": "It's just a little bet...", "9174": "You've just taken one step forward..." },
    "options": [
      { "id": 10901, "text": "50% chance to obtain Stella Coin ×100, 50% chance to obtain random Potential ×1", "resp": { "9133": "A gift...", "9172": "I gratefully accept.", "9173": "An unexpected gain!", "9174": "Thank you for everything." } },
      { "id": 10902, "text": "Spend Stella Coin ×120 to obtain random Potential ×1", "resp": { "9133": "Are you forcing a sale?!", "9172": "How about we just trade gifts instead.", "9173": "It's fine to pay a little price.", "9174": "I'm willing to pay for this." } }
    ]
  },
  "110": {
    "name": "Mystery Box (Rare)",
    "prompts": { "9133": "Do you want to buy this mystery box?", "9172": "You scratch my back, I scratch yours.", "9173": "It's just a little bet...", "9174": "You've just taken one step forward..." },
    "options": [
      { "id": 11001, "text": "50% chance to obtain Stella Coin ×120, 50% chance to obtain random Rare Potential ×1", "resp": { "9133": "A gift...", "9172": "I gratefully accept.", "9173": "An unexpected gain!", "9174": "Thank you for everything." } },
      { "id": 11002, "text": "Spend Stella Coin ×160 to obtain random Rare Potential ×1", "resp": { "9133": "Are you forcing a sale?!", "9172": "How about we just trade gifts instead.", "9173": "It's fine to pay a little price.", "9174": "I'm willing to pay for this." } }
    ]
  },
  "111": {
    "name": "Recover or Potential",
    "prompts": { "9133": "You look pretty hungry. Or is it that...", "9172": "Do you need more healing? Or is it that...", "9173": "Your HP can also be a chip, you know.", "9174": "So do you want to ... trade your HP for something?" },
    "options": [
      { "id": 11101, "text": "Recover 20% HP", "resp": { "9133": "Give me something tasty!", "9172": "I need medical attention.", "9173": "Give me some, please.", "9174": "No, I mean, I would like some HP from you..." } },
      { "id": 11102, "text": "Spend 20% HP to obtain random Common Potential ×1", "resp": { "9133": "Time for some thrills!", "9172": "I need strength.", "9173": "I guess I could try it...", "9174": "An exchange of powers..." } }
    ]
  },
  "112": {
    "name": "Recover or Potential",
    "prompts": { "9133": "You look pretty hungry. Or is it that...", "9172": "Do you need more healing? Or is it that...", "9173": "Your HP can also be a chip, you know.", "9174": "Do you want to ... trade your HP for something?" },
    "options": [
      { "id": 11201, "text": "Recover 20% HP", "resp": { "9133": "Give me something tasty!", "9172": "I need medical attention.", "9173": "Give me some, please.", "9174": "No, I mean, I would like some HP from you..." } },
      { "id": 11202, "text": "Spend 30% HP to obtain random Potential ×1", "resp": { "9133": "Time for some thrills!", "9172": "I need strength.", "9173": "I guess I could try it...", "9174": "An exchange of powers..." } }
    ]
  },
  "113": {
    "name": "Recover or Potential",
    "prompts": { "9133": "You look pretty hungry. Or is it that...", "9172": "Do you need more healing? Or is it that...", "9173": "Your HP can also be a chip, you know.", "9174": "Do you want to ... trade your HP for something?" },
    "options": [
      { "id": 11301, "text": "Recover 20% HP", "resp": { "9133": "Give me something tasty!", "9172": "I need medical attention.", "9173": "Give me some, please.", "9174": "No, I mean, I would like some HP from you..." } },
      { "id": 11302, "text": "Spend 30% HP to obtain random Potential ×1", "resp": { "9133": "Time for some thrills!", "9172": "I need strength.", "9173": "I guess I could try it...", "9174": "An exchange of powers..." } },
      { "id": 11303, "text": "Spend 50% HP to obtain random Rare Potential ×1", "resp": { "9133": "Give me the strongest, most invigorating one!", "9172": "I need a great deal of power!", "9173": "Let's have the wildest celebration!", "9174": "I want to trade for more power!" } }
    ]
  },
  "114": {
    "name": "Quiz — Notes",
    "prompts": { "9133": "What time do you think counts as \"staying up late\"?", "9172": "Which of the following helps with maintaining your health?", "9173": "Being true to your desire... What do you think that means?", "9174": "How would you define aiming high?" },
    "options": [
      { "id": 11401, "text": "Choose the correct answer to obtain random Musical Note ×10!", "resp": { "9133": "Eight o'clock?", "9172": "Stay up every night?", "9173": "Work hard to learn knowledge!", "9174": "Live however you please." } },
      { "id": 11402, "text": "Choose the correct answer to obtain random Musical Note ×10!", "resp": { "9133": "Nine o'clock?", "9172": "Sitting still too long?", "9173": "Exercise seriously!", "9174": "Seize the pleasure of the moment." } },
      { "id": 11403, "text": "Choose the correct answer to obtain random Musical Note ×10!", "resp": { "9133": "Twelve o'clock?", "9172": "Balanced Diet?", "9173": "Carpe diem!", "9174": "Make a plan and follow it through." } },
      { "id": 11404, "text": "Choose the correct answer to obtain random Musical Note ×10!", "resp": { "9133": "5 AM?", "9172": "Turn into a Stellaroid?", "9173": "Eat in moderation!", "9174": "Obey others' orders." } },
      { "id": 11405, "text": "Choose the correct answer to obtain random Musical Note ×10!", "resp": { "9133": "Eight o'clock tomorrow morning?", "9172": "Overeating?", "9173": "Working late into the night!", "9174": "Follow the crowd." } }
    ]
  },
  "115": {
    "name": "Quiz — Potential",
    "prompts": { "9133": "Take a guess... What's the Monolith's favorite number?", "9172": "Which food is better for your health?", "9173": "Take a guess... Which kind of Trekker do I admire more?", "9174": "Take a guess... Which kind of Trekker do I prefer to talk with?" },
    "options": [
      { "id": 11501, "text": "Choose the correct answer to obtain random Potential ×1!", "resp": { "9133": "1? Because there's only one path...", "9172": "Eat more Stellaroid?", "9173": "Someone clever and sharp.", "9174": "Someone who complains nonstop." } },
      { "id": 11502, "text": "Choose the correct answer to obtain random Potential ×1!", "resp": { "9133": "2? Because there's only up and down...", "9172": "Eat more grass?", "9173": "Someone who's warm and positive.", "9174": "Someone who goes with the crowd." } },
      { "id": 11503, "text": "Choose the correct answer to obtain random Potential ×1!", "resp": { "9133": "3? Because there are always three options...", "9172": "Eat more veg things?", "9173": "Someone who's governed by desire.", "9174": "Someone who aims high." } },
      { "id": 11504, "text": "Choose the correct answer to obtain random Potential ×1!", "resp": { "9133": "4? Because there are 4 of you...", "9172": "Eat more wood?", "9173": "Someone who's gloomy and pessimistic.", "9174": "Someone who refuses to think." } },
      { "id": 11505, "text": "Choose the correct answer to obtain random Potential ×1!", "resp": { "9133": "5? Because I always end up with 5 coins left...", "9172": "Eat more rocks?", "9173": "Someone who's foolish and slow.", "9174": "Someone who gives in too easily." } }
    ]
  },
  "116": {
    "name": "Quiz — Rare Potential",
    "prompts": { "9133": "Quiz time: What is 2 to the power of 10?", "9172": "Which of the following should you do less of for the sake of your health?", "9173": "Quiz time: How many notes are in an octave?", "9174": "Quiz time: How many faces does a cube have?" },
    "options": [
      { "id": 11601, "text": "Choose the correct answer to obtain random Rare Potential ×1!", "resp": { "9133": "64?", "9172": "Eat less breakfast?", "9173": "5?", "9174": "4?" } },
      { "id": 11602, "text": "Choose the correct answer to obtain random Rare Potential ×1!", "resp": { "9133": "256?", "9172": "Brush less?", "9173": "8?", "9174": "5?" } },
      { "id": 11603, "text": "Choose the correct answer to obtain random Rare Potential ×1!", "resp": { "9133": "1024?", "9172": "Don't sit too long?", "9173": "12?", "9174": "6?" } },
      { "id": 11604, "text": "Choose the correct answer to obtain random Rare Potential ×1!", "resp": { "9133": "4096?", "9172": "Less time in the sun?", "9173": "16?", "9174": "7?" } },
      { "id": 11605, "text": "Choose the correct answer to obtain random Rare Potential ×1!", "resp": { "9133": "65536?", "9172": "Less exercise?", "9173": "18?", "9174": "8?" } }
    ]
  },
  "117": {
    "name": "Magic Machine — Coin or HP",
    "prompts": { "9133": "This is a magical game machine... Wanna try it?", "9172": "This potion—who knows what will happen. Want to try it?", "9173": "The Gamble of Destiny is lighting up for you!", "9174": "You, too, want to step into destiny's mirror... Don't you?" },
    "options": [
      { "id": 11701, "text": "Stella Coin or HP randomly changes!", "resp": { "9133": "... Can I play it?", "9172": "Just a try!", "9173": "Alright, light it up!", "9174": "Magic Mirror... Please!" } },
      { "id": 11702, "text": "Obtain Stella Coin ×30", "resp": { "9133": "No, I don't want to.", "9172": "Maybe next time!", "9173": "Looks quite dangerous...", "9174": "No, this looks quite dangerous..." } }
    ]
  },
  "118": {
    "name": "Magic Machine — Coin/HP/Potential",
    "prompts": { "9133": "This is a magical game machine... Wanna try it?", "9172": "This potion—who knows what will happen. Want to try it?", "9173": "The Gamble of Destiny is lighting up for you!", "9174": "You, too, want to step into destiny's mirror... Don't you?" },
    "options": [
      { "id": 11801, "text": "Stella Coin, HP, or Potentials randomly changes!", "resp": { "9133": "... Can I play it?", "9172": "Just a try!", "9173": "Alright, light it up!", "9174": "Magic Mirror... Please!" } },
      { "id": 11802, "text": "Obtain Stella Coin ×30", "resp": { "9133": "No, I don't want to.", "9172": "Maybe next time!", "9173": "Looks quite dangerous...", "9174": "No, this looks quite dangerous..." } }
    ]
  },
  "119": {
    "name": "Magic Machine — Coin/Potential",
    "prompts": { "9133": "This is a magical game machine... Wanna try it?", "9172": "This potion—who knows what will happen. Want to try it?", "9173": "The Gamble of Destiny is lighting up for you!", "9174": "You, too, want to step into destiny's mirror... Don't you?" },
    "options": [
      { "id": 11901, "text": "Stella Coin or Potential randomly changes!", "resp": { "9133": "... Can I play it?", "9172": "Just a try!", "9173": "Alright, light it up!", "9174": "Magic Mirror... Please!" } },
      { "id": 11902, "text": "Obtain Stella Coin ×30", "resp": { "9133": "No, I don't want to.", "9172": "Maybe next time!", "9173": "Looks quite dangerous...", "9174": "No, this looks quite dangerous..." } }
    ]
  },
  "120": {
    "name": "Random Notes",
    "prompts": { "9133": "These are the goods I brought. Want to buy some?", "9172": "After listening to this music... You might gain something unexpected.", "9173": "Do you want to strike a deal with Destiny, or accept my charity?", "9174": "Do you want to negotiate with Destiny, or seek my favor?" },
    "options": [
      { "id": 12001, "text": "Spend Stella Coin ×50 to obtain random Musical Note ×5", "resp": { "9133": "Okay!", "9172": "Listen carefully.", "9173": "A fair trade!", "9174": "Business is business!" } },
      { "id": 12002, "text": "50% chance to recover 30% HP, 50% chance to obtain random Musical Note ×5", "resp": { "9133": "... Give me some scraps, that's all.", "9172": "Listen if you will.", "9173": "Give me something nice!", "9174": "Give me something nice!" } }
    ]
  },
  "121": {
    "name": "Random Potential",
    "prompts": { "9133": "These are the wonderful goods I brought. Want to buy some?", "9172": "Drink this potion and you'll be pleasantly surprised.", "9173": "Do you want to strike a deal with Destiny, or accept my charity?", "9174": "Do you want to negotiate with Destiny, or seek my favor?" },
    "options": [
      { "id": 12101, "text": "Spend Stella Coin ×100 to obtain random Potential ×1", "resp": { "9133": "Sure, I'll take this!", "9172": "One more for me!", "9173": "A fair trade!", "9174": "Business is business!" } },
      { "id": 12102, "text": "50% chance to recover 30% HP, 50% chance to obtain random Potential ×1", "resp": { "9133": "... Give me some scraps, that's all.", "9172": "Swallow it whole.", "9173": "Give me something nice!", "9174": "Give me something nice!" } }
    ]
  },
  "122": {
    "name": "Random Potential",
    "prompts": { "9133": "These are premium goods I barely managed to bring out! Want to buy some?", "9172": "Put on this medicinal patch, and you'll be... different.", "9173": "Do you want to strike a deal with Destiny, or accept my charity?", "9174": "Do you want to negotiate with Destiny, or seek my favor?" },
    "options": [
      { "id": 12201, "text": "Spend Stella Coin ×180 to obtain random Rare Potential ×1", "resp": { "9133": "Sweet! I'll buy it!", "9172": "One more for me!", "9173": "A fair trade!", "9174": "Business is business!" } },
      { "id": 12202, "text": "50% chance to recover 30% HP, 50% chance to obtain random Rare Potential ×1", "resp": { "9133": "... Give me some scraps, that's all.", "9172": "Slap it on in a hurry.", "9173": "Give me something nice!", "9174": "Give me something nice!" } }
    ]
  },
  "123": {
    "name": "Random Potential",
    "prompts": { "9133": "You could actually be sold as merchandise, too, you know that?", "9172": "Do you want healing, or a trade?", "9173": "Your HP ... can also be a chip, you know that?", "9174": "Offer up just the right amount of HP, and then you can..." },
    "options": [
      { "id": 12301, "text": "Spend Stella Coin ×50 to recover 20% HP", "resp": { "9133": "My limbs aren't for sale...", "9172": "I need medical attention...", "9173": "Then I want more chips.", "9174": "Maybe this is not the way." } },
      { "id": 12302, "text": "Spend 30% Max HP to obtain random Potential ×1", "resp": { "9133": "What do you want?", "9172": "Can Stamina also be traded?", "9173": "Don't forget to patch me up!", "9174": "Sounds like a very attractive proposition..." } }
    ]
  },
  "124": {
    "name": "Random Potential",
    "prompts": { "9133": "This is a magical game machine... Wanna try it?", "9172": "This potion—who knows what will happen. Want to try it?", "9173": "The Gamble of Destiny is lighting up for you!", "9174": "You, too, want to step into destiny's mirror... Don't you?" },
    "options": [
      { "id": 12401, "text": "33% chance to obtain Potential ×1, 33% chance to restore 20% HP, 33% chance to lose 30% HP", "resp": { "9133": "... Can I play it?", "9172": "Just a try!", "9173": "Alright, light it up!", "9174": "Magic Mirror... Please!" } },
      { "id": 12402, "text": "Obtain Stella Coin ×30", "resp": { "9133": "No, I don't want to.", "9172": "Maybe next time!", "9173": "Looks quite dangerous...", "9174": "No, this looks quite dangerous..." } }
    ]
  },
  "125": {
    "name": "Random Potential",
    "prompts": { "9133": "This is a magical game machine... Wanna try it?", "9172": "This potion—who knows what will happen. Want to try it?", "9173": "The Gamble of Destiny is lighting up for you!", "9174": "You, too, want to step into destiny's mirror... Don't you?" },
    "options": [
      { "id": 12501, "text": "33% chance to obtain Common Potential ×1, 33% chance to restore 20% HP, 33% chance to lose 20% HP", "resp": { "9133": "I've wanted to play this for a long time!", "9172": "Here's to our friendship!", "9173": "Bring on the storm!", "9174": "I am the master of my own destiny!" } },
      { "id": 12502, "text": "33% chance to obtain Rare Potential ×1, 33% chance to restore 30% HP, 33% chance to lose 50% HP", "resp": { "9133": "I've wanted to play this for a long time!", "9172": "Here's to our friendship!", "9173": "Bring on the storm!", "9174": "I am the master of my own destiny!" } },
      { "id": 12503, "text": "Obtain Stella Coin ×30", "resp": { "9133": "No, I don't want to.", "9172": "Maybe next time!", "9173": "Looks quite dangerous...", "9174": "No, this looks quite dangerous..." } }
    ]
  },
  "126": {
    "name": "Friendship — Support Potential",
    "prompts": { "9133": "It's so great to have friends...", "9172": "On the climb up the Monolith, don't forget the companions who support each other.", "9173": "Destiny has tied you together...", "9174": "You're all chasing the same thing..." },
    "options": [
      { "id": 12601, "text": "Obtain random Common Potential ×1 for a support Trekker", "resp": { "9133": "All of us can be your friends!", "9172": "Let's help each other!", "9173": "Our teamwork is perfect.", "9174": "We are kindred spirits." } },
      { "id": 12602, "text": "Recover 20% HP", "resp": { "9133": "If you don't mind ... I, too...", "9172": "I'll protect my companions!", "9173": "Our friendship will last forever.", "9174": "Nothing can come between us." } }
    ]
  },
  "127": {
    "name": "Friendship — Potential & Notes",
    "prompts": { "9133": "It's so great to have friends...", "9172": "On the climb up the Monolith, don't forget the companions who support each other.", "9173": "Destiny has tied you together...", "9174": "You're all chasing the same thing..." },
    "options": [
      { "id": 12701, "text": "Obtain random Potential ×1 for a support Trekker", "resp": { "9133": "All of us can be your friends!", "9172": "Let's help each other!", "9173": "Our teamwork is perfect.", "9174": "We are kindred spirits." } },
      { "id": 12702, "text": "Obtain random Musical Note ×5", "resp": { "9133": "If you don't mind ... I, too...", "9172": "We'll divide the tasks.", "9173": "Our friendship will last forever.", "9174": "Nothing can come between us." } }
    ]
  },
  "128": {
    "name": "Friendship — Rare Potential & Coins",
    "prompts": { "9133": "It's so great to have friends...", "9172": "On the climb up the Monolith, don't forget the companions who support each other.", "9173": "Destiny has tied you together...", "9174": "You're all chasing the same thing..." },
    "options": [
      { "id": 12801, "text": "Obtain random Rare Potential ×1 for a support Trekker", "resp": { "9133": "All of us can be your friends!", "9172": "It's important to share the rewards.", "9173": "Our friendship will last forever.", "9174": "Nothing can come between us." } },
      { "id": 12802, "text": "Obtain Stella Coin ×30", "resp": { "9133": "If you don't mind ... I, too...", "9172": "It's important to share the rewards.", "9173": "Our friendship will last forever.", "9174": "Nothing can come between us." } }
    ]
  }
};

// Options whose outcome is rolled. Stated odds are quoted from the game's own
// option text (EventOptions.json).
// Note: HP deltas are not part of the select response, so HP outcomes show up as
// "no visible reward" in the observed counts.
ST.RANDOM_OPTIONS = {
  10501: { doc: '50% → +200 coins · 50% → −100 coins' },
  10502: { doc: '30% → +650 coins · 70% → −200 coins' },
  10601: { doc: '50% → potential · 50% → nothing (stated 20% HP cost not observable in log)' },
  10901: { doc: '50% → +100 coins · 50% → potential' },
  11001: { doc: '50% → +120 coins · 50% → potential' },
  11701: { doc: 'coin or HP randomly changes (HP not visible in log)' },
  11801: { doc: 'coin, HP, or potential randomly changes (HP not visible in log)' },
  11901: { doc: 'coin or potential randomly changes' },
  12002: { doc: '50% → recover 30% HP · 50% → note ×5 (HP not visible in log)' },
  12102: { doc: '50% → recover 30% HP · 50% → potential (HP not visible in log)' },
  12202: { doc: '50% → recover 30% HP · 50% → potential (HP not visible in log)' },
  12401: { doc: '33% → potential · 33% → +20% HP · 33% → −30% HP (HP not visible in log)' },
  12501: { doc: '33% → potential · 33% → +20% HP · 33% → −20% HP (HP not visible in log)' },
  12502: { doc: '33% → potential · 33% → +30% HP · 33% → −50% HP (HP not visible in log)' }
};

// Options that also roll WHICH reward/cost you get, but with a single outcome shape
ST.ROLLED_REWARD_OPTIONS = [10101, 10102, 10201, 10202, 10203, 10301, 10401, 10402, 10602];

ST.eventFloorFilter = { hideEmpty: true };

ST.renderEvents = function() {
    var panel = document.getElementById('panel-events');
    if (!panel) return;

    var events = ST.allEventRng || [];
    var resolved = events.filter(function(e) { return e.resolved; });
    var unresolved = events.length - resolved.length;

    // Resolve the selected option id for each observed event
    resolved.forEach(function(e) {
        var idx = e.selectedIdx;
        if (idx == null || idx < 0 || idx >= (e.options || []).length) idx = (e.selectedIdx || 1) - 1;
        e._selOption = (e.options && e.options[idx] != null) ? e.options[idx] : -1;
    });

    // Aggregate observed outcomes per (event, option)
    var groups = {};
    resolved.forEach(function(e) {
        var key = e.evtId + '/' + e._selOption;
        if (!groups[key]) groups[key] = { evtId: e.evtId, optionId: e._selOption, occ: [] };
        groups[key].occ.push(e);
    });

    var html = '<div class="scroll-panel">';

    html += '<div class="chart-card"><h3>Summary</h3><p style="font-size:12px;color:#666;">' +
        events.length + ' NPC events seen · ' + resolved.length + ' resolved' +
        (unresolved > 0 ? ' · ' + unresolved + ' unresolved' : '') +
        ' · ' + Object.keys(groups).length + ' distinct event/option picks</p>' +
        '<p style="font-size:11px;color:#666;">Stated odds come from the in-game option text (EventOptions.json). Observed counts come from your logged runs.</p></div>';

    // ── 1. Random-outcome options: documented vs observed ──
    html += '<div class="chart-card"><h3>Random-Outcome Options — documented odds vs observed</h3>';
    html += '<table class="data-table"><tr><th>Event</th><th>Option</th><th>Documented outcome</th><th>Observed outcomes</th><th class="num">Picks</th></tr>';

    var randomIds = Object.keys(ST.RANDOM_OPTIONS).map(Number).sort(function(a, b) { return a - b; });
    var anyRandomSeen = false;
    randomIds.forEach(function(optId) {
        var evtId = Math.floor(optId / 100);
        var meta = ST.RANDOM_OPTIONS[optId];
        var cat = (ST.EVENT_CATALOG[evtId] || { options: [] }).options.filter(function(o) { return o.id === optId; })[0];
        var g = groups[evtId + '/' + optId];
        var picks = g ? g.occ.length : 0;
        if (picks > 0) anyRandomSeen = true;

        var observed = '<span style="color:#555">not picked yet</span>';
        if (picks > 0) {
            var counts = {};
            var order = [];
            g.occ.forEach(function(e) {
                var lbl = ST._eventOutcomeLabel(e, optId);
                if (!counts[lbl]) { counts[lbl] = 0; order.push(lbl); }
                counts[lbl]++;
            });
            observed = order.map(function(lbl) {
                var pct = (counts[lbl] / picks * 100).toFixed(0) + '%';
                return '<div><b>' + lbl + '</b> ×' + counts[lbl] + ' <span style="color:#888">(' + pct + ')</span></div>';
            }).join('');
        }

        var optText = cat ? cat.text : ('Option ' + optId);
        html += '<tr onclick="ST.toggleEventDetail(\'rnd' + optId + '\',this)" style="cursor:pointer">' +
            '<td>' + evtId + ' — ' + (ST.EVENT_CATALOG[evtId] ? ST.EVENT_CATALOG[evtId].name : '?') + '</td>' +
            '<td style="max-width:220px">' + ST._escape(optText) + '</td>' +
            '<td style="font-size:11px;color:#888;max-width:220px">' + meta.doc + '</td>' +
            '<td>' + observed + '</td>' +
            '<td class="num">' + picks + '</td></tr>';

        // Detail: NPC response texts + per-occurrence rows
        html += '<tr class="evt-detail" id="evt-detail-rnd' + optId + '" style="display:none"><td colspan="5" style="padding:4px 16px 10px">';
        if (cat) {
            html += '<p style="font-size:11px;color:#666;margin:4px 0;"><b>NPC responses:</b> ';
            html += Object.keys(cat.resp).map(function(npc) {
                return ST.NPC_NAMES[npc] || npc + ': "' + ST._escape(cat.resp[npc]) + '"';
            }).join(' · ') + '</p>';
        }
        if (picks > 0) {
            html += '<table class="data-table" style="width:100%"><tr><th>#</th><th>Run</th><th>Floor</th><th>NPC</th><th>Result</th><th>Outcome</th><th>Deltas</th></tr>';
            g.occ.forEach(function(e, i) {
                var res = e.optionsResult === false ? '<span style="color:#ba7a7a">FAIL</span>' : '<span style="color:#7aba7a">OK</span>';
                html += '<tr><td>' + (i + 1) + '</td><td>' + e.runId + '</td><td class="num">' + e.floor + '</td><td>' + (ST.NPC_NAMES[e.npcId] || e.npcId) + '</td><td>' + res + '</td><td>' + ST._eventOutcomeLabel(e, optId) + '</td><td style="font-size:10px;color:#666">' + ST._deltaStr(e) + '</td></tr>';
            });
            html += '</table>';
        }
        html += '</td></tr>';
    });
    html += '</table>';
    if (!anyRandomSeen) html += '<p style="font-size:11px;color:#888;margin-top:6px;">None of the random-outcome options have been picked in the logged runs yet.</p>';
    html += '</div>';

    // ── Spawn-rate stats: rooms visited per floor vs NPC events seen ──
    // Distinct (runId, floor) pairs = room visits; an event "appearing" = a distinct
    // (runId, floor) room where a caseType-6 NPC event case existed.
    var roomVisits = {};      // floor -> count of distinct rooms visited
    var seenRooms = {};
    ST.allRoomVisits.forEach(function(r) {
        if (r.floor == null) return;
        var k = r.runId + '/' + r.floor;
        if (!seenRooms[k]) { seenRooms[k] = 1; roomVisits[r.floor] = (roomVisits[r.floor] || 0) + 1; }
    });
    var evRooms = {};         // floor -> { roomCount, byEvt: { evtId -> roomCount } }
    (ST.allEventRng || []).forEach(function(e) {
        if (e.floor == null) return;
        var k = e.runId + '/' + e.floor;
        if (!evRooms[e.floor]) evRooms[e.floor] = { roomCount: 0, seen: {}, byEvt: {} };
        if (!evRooms[e.floor].seen[k]) { evRooms[e.floor].seen[k] = 1; evRooms[e.floor].roomCount++; }
        if (!evRooms[e.floor].byEvt[e.evtId]) evRooms[e.floor].byEvt[e.evtId] = {};
        if (!evRooms[e.floor].byEvt[e.evtId][k]) evRooms[e.floor].byEvt[e.evtId][k] = 1;
    });

    var floors = {};
    Object.keys(roomVisits).forEach(function(f) { floors[f] = 1; });
    Object.keys(evRooms).forEach(function(f) { floors[f] = 1; });
    var floorList = Object.keys(floors).map(Number).sort(function(a, b) { return a - b; });

    // ── Raw table: floor -> % of rooms with any event ──
    html += '<div class="chart-card"><h3>Event Appearance by Floor (raw)</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">% = distinct rooms visited at that floor that contained any NPC event case. One room visit per (run, floor).</p>';
    html += '<p style="font-size:11px;margin:0 0 8px;"><label style="cursor:pointer;"><input type="checkbox" ' + (ST.eventFloorFilter.hideEmpty ? 'checked' : '') + ' onchange="ST.eventFloorFilter.hideEmpty=this.checked;ST.renderEvents()"> hide floors with 0 events</label></p>';
    html += '<table class="data-table"><tr><th class="num">Floor</th><th class="num">Times visited</th><th class="num">With event</th><th class="pct">Event %</th></tr>';
    floorList.forEach(function(f) {
        var rooms = roomVisits[f] || 0;
        var withEv = evRooms[f] ? evRooms[f].roomCount : 0;
        if (ST.eventFloorFilter.hideEmpty && withEv === 0) return;
        var pct = rooms > 0 ? (withEv / rooms * 100).toFixed(0) + '%' : '—';
        html += '<tr><td class="num">' + f + '</td><td class="num">' + rooms + '</td><td class="num">' + withEv + '</td><td class="pct">' + pct + '</td></tr>';
    });
    html += '</table></div>';

    // ── Per-event spawn rate by floor ──
    html += '<div class="chart-card"><h3>Event Spawn Rate by Floor (per event)</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">Each line: how many rooms at that floor contained this event, as % of rooms visited there. Sorted by event id.</p>';
    html += '<table class="data-table"><tr><th class="num">Floor</th><th class="num">Times visited</th><th class="num">With event</th><th>Events</th></tr>';
    floorList.forEach(function(f) {
        var rooms = roomVisits[f] || 0;
        var info = evRooms[f];
        var withEv = info ? info.roomCount : 0;
        var pct = rooms > 0 ? (withEv / rooms * 100).toFixed(0) + '%' : '—';
        var evLines = '';
        if (info) {
            evLines = Object.keys(info.byEvt).map(Number).sort(function(a, b) { return a - b; }).map(function(evtId) {
                var n = Object.keys(info.byEvt[evtId]).length;
                var p = rooms > 0 ? (n / rooms * 100).toFixed(0) + '%' : '—';
                var name = ST.EVENT_CATALOG[evtId] ? ST.EVENT_CATALOG[evtId].name : '';
                return '<div style="font-size:11px;">' + evtId + (name ? ' ' + name : '') + ' — ' + n + ' <span style="color:#888">(' + p + ')</span></div>';
            }).join('');
        }
        html += '<tr><td class="num">' + f + '</td><td class="num">' + rooms + '</td><td class="num">' + withEv + ' <span style="color:#888">(' + pct + ')</span></td><td>' + (evLines || '<span style="color:#555">none</span>') + '</td></tr>';
    });
    html += '</table></div>';

    // ── 2. Full catalog of all NPC events ──
    html += '<div class="chart-card"><h3>Event Catalog (all events)</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">All 28 events from StarTowerEvent.json, with the actual in-game text. "(rolled)" marks options whose reward is rolled.</p>';

    Object.keys(ST.EVENT_CATALOG).map(Number).sort(function(a, b) { return a - b; }).forEach(function(evtId) {
        var evt = ST.EVENT_CATALOG[evtId];
        var seen = resolved.filter(function(e) { return e.evtId === evtId; }).length;
        var key = 'cat' + evtId;
        html += '<div style="border:1px solid #2a2a2a;border-radius:6px;margin-bottom:8px;padding:8px 12px;' + (seen > 0 ? '' : 'opacity:0.75;') + '">';
        html += '<div style="cursor:pointer" onclick="ST.toggleEventDetail(\'' + key + 'body\')">' +
            '<b>' + evtId + ' — ' + evt.name + '</b>' +
            ' <span style="color:#888;font-size:11px;">(' + seen + ' seen)</span>' +
            '<span style="float:right;color:#666;font-size:10px;">show/hide</span></div>';
        html += '<div id="evt-detail-' + key + 'body" style="display:none;margin-top:8px;">';
        html += '<p style="font-size:11px;color:#777;margin:2px 0 8px;">' + Object.keys(evt.prompts).map(function(npc) {
            return '<b>' + (ST.NPC_NAMES[npc] || npc) + ':</b> "' + ST._escape(evt.prompts[npc]) + '"';
        }).join('<br>') + '</p>';
        html += '<table class="data-table"><tr><th class="num">Id</th><th>Option text</th><th>Response (per NPC)</th><th class="num">Picked</th></tr>';
        evt.options.forEach(function(o) {
            var g = groups[evtId + '/' + o.id];
            var picks = g ? g.occ.length : 0;
            var rolled = ST.RANDOM_OPTIONS[o.id] || ST.ROLLED_REWARD_OPTIONS.indexOf(o.id) >= 0;
            html += '<tr><td class="num">' + o.id + '</td>' +
                '<td style="max-width:260px">' + (rolled ? '<span style="color:#c8a050">(rolled) </span>' : '') + ST._escape(o.text) + '</td>' +
                '<td style="font-size:10px;color:#777;max-width:340px">' + Object.keys(o.resp).map(function(npc) {
                    return (ST.NPC_NAMES[npc] || npc) + ': "' + ST._escape(o.resp[npc]) + '"';
                }).join('<br>') + '</td>' +
                '<td class="num">' + (picks > 0 ? picks : '<span style="color:#555">0</span>') + '</td></tr>';
        });
        html += '</table></div></div>';
    });
    html += '</div>';

    // ── 3. Unresolved (seen but never answered) ──
    var pendingList = (ST.allEventRng || []).filter(function(e) { return !e.resolved; });
    if (pendingList.length > 0) {
        html += '<div class="chart-card"><h3>Unresolved Events</h3><table class="data-table"><tr><th>Event</th><th>NPC</th><th>Options offered</th><th>Run</th><th>Floor</th></tr>';
        pendingList.forEach(function(e) {
            html += '<tr><td>' + e.evtId + (ST.EVENT_CATALOG[e.evtId] ? ' — ' + ST.EVENT_CATALOG[e.evtId].name : '') + '</td><td>' + (ST.NPC_NAMES[e.npcId] || e.npcId) + '</td><td><span style="font-size:10px;color:#555">[' + (e.options || []).join(', ') + ']</span></td><td class="num">' + e.runId + '</td><td class="num">' + e.floor + '</td></tr>';
        });
        html += '</table></div>';
    }

    panel.innerHTML = html + '</div>';
};

// Classify the visible outcome of one resolved NPC event pick.
// Potentials and notes are not differentiated by type/subtype — just "potential" / "note".
ST._eventOutcomeLabel = function(e, optId) {
    if (!e.resolved) return 'pending';
    if (e.optionsResult === false) return 'fail';

    var coin = 0;
    var noteQty = 0;
    var gotPotential = false;
    (e.items || []).forEach(function(it) {
        if (it.tid === 11) coin += (it.qty || 0);
        else if (ST.isNote(it.tid)) noteQty += Math.max(0, it.qty || 0);
        else if (ST.isPotential(it.tid)) gotPotential = true;
    });
    (e.subNoteSkills || []).forEach(function(sn) {
        if (ST.isNote(sn.tid) && (sn.qty || 0) > 0) noteQty += sn.qty;
    });
    var sel = e.potSelectors || [];

    var parts = [];
    if (coin > 0) parts.push('+' + coin + ' coins');
    if (coin < 0) parts.push(coin + ' coins');
    if (noteQty > 0) parts.push('note ×' + noteQty);
    if (gotPotential || sel.length > 0) parts.push('potential');
    if (parts.length === 0) return 'no visible reward';
    return parts.join(', ');
};

ST._deltaStr = function(e) {
    var parts = [];
    (e.items || []).forEach(function(it) {
        parts.push((it.tid === 11 ? 'coin' : ST.isNote(it.tid) ? 'note' : ST.isPotential(it.tid) ? 'potential' : 'TID' + it.tid) + ' ' + (it.qty > 0 ? '+' : '') + (it.qty || 0));
    });
    (e.subNoteSkills || []).forEach(function(sn) {
        parts.push('note +' + sn.qty);
    });
    (e.potSelectors || []).forEach(function(s) {
        parts.push('potential' + (s.tids && s.tids.length ? '(' + s.tids.join(',') + ')' : ''));
    });
    return parts.join(', ') || '—';
};

ST._escape = function(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

ST.toggleEventDetail = function(key) {
    var row = document.getElementById('evt-detail-' + key);
    if (!row) return;
    row.style.display = row.style.display === 'none' ? '' : 'none';
};
