# Greyhaven Phone v1.2.2

Focused social-boundary hotfix for Greyhaven Phone.

## Main changes

### Leave on read is now much easier to trigger
Silence is now treated as a normal social response, not a rare edge case.

A character can leave the phone owner on read when:
- they are genuinely angry,
- they explicitly say they need space,
- they say they do not want to talk,
- they say they are done with the conversation,
- they have already told the owner to leave them alone,
- the owner keeps pushing after a clear boundary.

When Greyhaven Phone chooses a deterministic leave-on-read state:
- there is no reply bubble,
- there is no typing indicator,
- the contact remains in an ignoring state,
- later messages may continue to be ignored.

A real apology can still reopen the conversation naturally.

### Blocking escalates sooner after a clear boundary
The extension no longer waits for four or five nearly identical warning messages.

Examples:
- Contact says "leave me alone" -> ordinary continued pushing is likely to be left on read.
- Contact says "leave me alone" -> owner immediately sends explicit sexual pressure or severe harassment -> the contact can block immediately.
- Contact leaves the owner on read after a hard boundary -> continued persistence can quickly become a block.
- A credible threat, forced-entry threat, coercive threat, or severe harassment can justify blocking without several warnings.

Temporary anger is treated differently:
- "I need space / I don't want to talk right now" normally causes silence first,
- it does not immediately become a block just because one or two ordinary follow-up messages arrive,
- extreme persistence or a serious threat can still escalate.

### Model + deterministic boundary logic
The model still decides personality-specific reactions and can:
- swear,
- mock,
- get angry,
- give one warning,
- leave on read,
- block.

But after a character has already expressed a very clear boundary, Greyhaven Phone now has a lightweight local boundary layer too. This prevents the model from endlessly generating another warning instead of actually going silent or blocking.

This local layer does not require an extra AI call.

### Final-warning block detection
If the character says something like:
- "I'm blocking you"
- "I'm going to block you"
- "you're blocked"

Greyhaven Phone also recognizes that as a real block even if the model forgot the `ACTION: BLOCK` protocol line.

### Existing v1.2.1 media fixes are retained
Photo/video requests still keep the improved behavior:
- actual promises must become real media or a clear change of mind,
- refusals stay text-only,
- same-line `TEXT:` + `PHOTO:` / `VIDEO:` parsing works,
- fake media cards are not created from ordinary promise text.

### Phone <-> roleplay continuity is unchanged
The chronology and world-continuity behavior from v1.2.0 remains intact.

## Suggested tests

You no longer need extreme test messages just to see whether the feature works.

### Leave on read
1. Have a character say: "I'm mad at you. I don't want to talk right now."
2. Send: "Come on, answer me."
3. They should now be able to leave you on read with no typing bubble.

### Hard boundary
1. Have a low-trust contact say: "Leave me alone. Don't message me again."
2. Send one ordinary pushy follow-up.
3. They should normally leave it on read.
4. Continue again and the contact can escalate to blocking.

### Faster severe block
1. Have the contact clearly say to stop / leave them alone.
2. Send a clearly severe or sexually aggressive follow-up.
3. The contact can block immediately rather than repeating several warnings.

### Reconciliation
1. Get left on read.
2. Send a believable apology.
3. The extension should allow the model to decide whether the character keeps ignoring you or re-engages.
