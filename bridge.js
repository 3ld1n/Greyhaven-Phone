import './index.js';

/*
 * Greyhaven Phone v2.3.0 bridge layer
 * Extends the tested Phone core with:
 * - shared Greyhaven World/Event Ledger materialization
 * - RP -> Phone message/media/call/block mirroring
 * - optional one-hop background replies (never recursive)
 * - Greyhaven Life one-time plans inside Calendar
 */

const BRIDGE_VERSION = '2.3.0';
const CORE_VERSION = '2.3.0';
const PHONE_META_KEY = 'greyhavenPhone';
const MAX_PROCESSED = 320;
const DEFAULT_RELAY_TOKENS = 420;

let ready = false;
let bound = false;
let uiObserver = null;
let relayQueue = Promise.resolve();
let calendarQueued = false;

const norm = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const lc = v => norm(v).toLowerCase();
const esc = v => String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');
const slug = v => norm(v).toLowerCase().replace(/[’']/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'') || 'person';
const clone = v => {
    if (v == null) return v;
    try { return structuredClone(v); } catch {}
    return JSON.parse(JSON.stringify(v));
};
const uid = () => {
    try { return crypto.randomUUID(); }
    catch { return `ghpb-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};
const ctx = () => {
    try { return globalThis.SillyTavern?.getContext?.() ?? null; }
    catch { return null; }
};
const hasChat = () => {
    const c = ctx();
    return !!(c?.chatMetadata && (c?.getCurrentChatId?.() || c?.chatId));
};
const rpNowMs = () => {
    try {
        const d = globalThis.GreyhavenLife?.getTime?.();
        const x = d ? new Date(d) : null;
        if (x && !Number.isNaN(x.getTime())) return x.getTime();
    } catch {}
    return Date.now();
};
const roleplayTimeText = ms => {
    const d = new Date(Number(ms || rpNowMs()));
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
        weekday:'short', month:'short', day:'numeric',
        hour:'2-digit', minute:'2-digit', hour12:false,
    }).format(d);
};

function findCharacter(name) {
    const c = ctx(), key = lc(name);
    if (!c?.characters || !key) return null;
    const index = c.characters.findIndex(ch => lc(ch?.name) === key);
    return index >= 0 ? {character:c.characters[index], index} : null;
}
function charAvatar(name) {
    const found = findCharacter(name);
    const avatar = found?.character?.avatar || '';
    if (!avatar) return '';
    try { return ctx()?.getThumbnailUrl?.('avatar', avatar) || avatar; }
    catch { return avatar; }
}
function cardData(name) {
    const found = findCharacter(name);
    const ch = found?.character;
    if (!ch) return null;
    const read = k => {
        const v = ch?.[k] ?? ch?.data?.[k];
        return typeof v === 'string' ? v.trim() : '';
    };
    return {
        name:norm(ch.name || name),
        description:read('description').slice(0,7000),
        personality:read('personality').slice(0,5000),
        scenario:read('scenario').slice(0,3000),
        examples:read('mes_example').slice(0,5000),
    };
}
function activePersonaDescriptionFor(name) {
    const c = ctx();
    if (lc(c?.name1) !== lc(name)) return '';
    const p = c?.powerUserSettings || {};
    const descs = p.persona_descriptions || p.personaDescriptions || {};
    const personas = p.personas || {};
    const candidates = [p.persona_description];

    // Match the same persona stores Greyhaven Phone core already understands.
    for (const [avatarId, personaName] of Object.entries(personas)) {
        if (lc(personaName) !== lc(name)) continue;
        candidates.push(descs?.[avatarId], descs?.[String(avatarId).split('/').pop()]);
    }
    for (const [key,value] of Object.entries(descs || {})) {
        if (lc(key) === lc(name)) candidates.push(value);
        if (value && typeof value === 'object' && lc(value.name) === lc(name)) {
            candidates.push(value.description,value.prompt,value.text);
        }
    }
    for (const value of candidates.flat()) {
        if (typeof value === 'string' && value.trim()) return value.trim().slice(0,9000);
        if (value && typeof value === 'object') {
            for (const key of ['description','prompt','text']) {
                if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim().slice(0,9000);
            }
        }
    }
    return '';
}
function speakerData(name) {
    return cardData(name) || {
        name:norm(name),
        description:activePersonaDescriptionFor(name),
        personality:'',
        scenario:'',
        examples:'',
    };
}
function scenarioText() {
    const c = ctx();
    let text = norm(c?.chatMetadata?.scenario || '');
    if (!text && c?.groupId) {
        const g = c.groups?.find(x => String(x?.id) === String(c.groupId));
        text = norm(g?.scenario || '');
    }
    if (!text && !c?.groupId) {
        try {
            const fields = c?.getCharacterCardFields?.();
            text = norm(fields?.scenario || fields?.data?.scenario || '');
        } catch {}
        if (!text) {
            const ch = c?.characters?.[Number(c?.characterId)];
            text = norm(ch?.scenario || ch?.data?.scenario || '');
        }
    }
    if (text.length > 10000) text = `${text.slice(0,7000)}\n[…scenario shortened…]\n${text.slice(-2500)}`;
    return text;
}
function recentRoleplay(maxMessages=18, maxChars=10000) {
    const c = ctx(), chat = Array.isArray(c?.chat) ? c.chat : [];
    const lines = [];
    let chars = 0;
    for (let i=chat.length-1; i>=0 && lines.length<maxMessages; i--) {
        const m = chat[i], text = String(m?.mes ?? m?.text ?? '').trim();
        if (!text) continue;
        const who = norm(m?.name || (m?.is_user ? c?.name1 : c?.name2) || 'Unknown');
        const line = `${who}: ${text}`;
        if (chars + line.length > maxChars && lines.length) break;
        lines.unshift(line);
        chars += line.length;
    }
    return lines.join('\n');
}

/* ---------------- Phone metadata helpers ---------------- */

function defaultContinuity() {
    return {version:1,seq:0,events:[],rpCheckpoint:{seq:0,roleplayMs:0,realMs:0,chatLength:0}};
}
function defaultTimeline(ownerName='',ownerAvatar='') {
    return {
        version:5, ownerName:norm(ownerName), ownerAvatar:ownerAvatar || '', identityId:'',
        createdAt:Date.now(), updatedAt:Date.now(),
        contacts:{}, contactOrder:[], suppressedContacts:[],
        relationships:{},
        threads:{}, threadOrder:[], calls:[], posts:[], stories:[],
        instagram:{posts:[],stories:[],notifications:[],threads:{},threadOrder:[]},
        snapchat:{stories:[],memories:[],eyesOnly:[],notifications:[],threads:{},threadOrder:[]},
        facebook:{posts:[],notifications:[],friendRequests:[],marketplace:{listings:[]},threads:{},threadOrder:[]},
        dominos:{cart:[],notifications:[]},
        uber:{savedDestination:'',notifications:[]},
        onlyfans:{posts:[],notifications:[],threads:{},threadOrder:[]},
        darkweb:{notifications:[],threads:{},threadOrder:[]},
        notifications:[], photos:[], notes:[], mail:[],
        refresh:{lastAt:null,chatLength:0,eventKeys:[],summary:''},
    };
}
function phoneRoot(create=true) {
    const c = ctx();
    if (!c?.chatMetadata || !hasChat()) return null;
    let root = c.chatMetadata[PHONE_META_KEY];
    if ((!root || typeof root !== 'object') && create) {
        root = {version:5, phones:{}, continuity:defaultContinuity(), worldBridge:{processed:[]}, services:{}, onlyFans:{}, darkWeb:{}};
        c.chatMetadata[PHONE_META_KEY] = root;
    }
    if (!root || typeof root !== 'object') return null;
    root.version = Math.max(5, Number(root.version || 5));
    if (!root.phones || typeof root.phones !== 'object') root.phones = {};
    if (!root.continuity || typeof root.continuity !== 'object') root.continuity = defaultContinuity();
    if (!Array.isArray(root.continuity.events)) root.continuity.events = [];
    root.continuity.seq = Math.max(
        Number(root.continuity.seq || 0),
        ...root.continuity.events.map(e => Number(e?.seq || 0)),
        0,
    );
    if (!root.worldBridge || typeof root.worldBridge !== 'object') root.worldBridge = {};
    if (!Array.isArray(root.worldBridge.processed)) root.worldBridge.processed = [];
    if (!root.services || typeof root.services !== 'object') root.services = {};
    if (!root.onlyFans || typeof root.onlyFans !== 'object') root.onlyFans = {};
    if (!root.darkWeb || typeof root.darkWeb !== 'object') root.darkWeb = {};
    return root;
}
function saveRoot(root) {
    const c = ctx();
    if (!root || !c?.chatMetadata || !hasChat()) return;
    root.worldBridge ||= {};
    root.worldBridge.processed = Array.isArray(root.worldBridge.processed)
        ? root.worldBridge.processed.slice(-MAX_PROCESSED) : [];
    c.chatMetadata[PHONE_META_KEY] = root;
    try {
        c.updateChatMetadata?.({[PHONE_META_KEY]:root});
        if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
        else c.saveMetadata?.();
    } catch (e) {
        console.warn('[greyhaven-phone-bridge] metadata save', e);
    }
}
function normalizeTimelineLite(t, ownerName='') {
    if (!t || typeof t !== 'object') t = defaultTimeline(ownerName);
    t.version = Math.max(5, Number(t.version || 5));
    t.ownerName = norm(t.ownerName || ownerName);
    t.ownerAvatar ||= '';
    t.identityId ||= globalThis.GreyhavenPhone?.getIdentityByName?.(t.ownerName)?.id || '';
    for (const k of ['contacts','relationships','threads']) if (!t[k] || typeof t[k] !== 'object') t[k] = {};
    for (const k of ['contactOrder','suppressedContacts','threadOrder','calls','posts','stories','notifications','photos','notes','mail']) {
        if (!Array.isArray(t[k])) t[k] = [];
    }
    t.refresh = t.refresh && typeof t.refresh === 'object'
        ? t.refresh : {lastAt:null,chatLength:0,eventKeys:[],summary:''};
    t.instagram ||= {posts:t.posts,stories:t.stories,notifications:[],threads:{},threadOrder:[]};
    t.snapchat ||= {stories:[],memories:[],eyesOnly:[],notifications:[],threads:{},threadOrder:[]};
    t.facebook ||= {posts:[],notifications:[],friendRequests:[],marketplace:{listings:[]},threads:{},threadOrder:[]};
    t.dominos ||= {cart:[],notifications:[]};
    t.uber ||= {savedDestination:'',notifications:[]};
    t.onlyfans ||= {posts:[],notifications:[],threads:{},threadOrder:[]};
    t.darkweb ||= {notifications:[],threads:{},threadOrder:[]};
    return t;
}
function phoneForOwner(ownerName, ownerAvatar='', create=true) {
    const root = phoneRoot(create), name = norm(ownerName);
    if (!root || !name) return null;
    let hit = Object.entries(root.phones).find(([,t]) => lc(t?.ownerName) === lc(name));
    if (hit) {
        const timeline = normalizeTimelineLite(hit[1], name);
        timeline.ownerName = name;
        timeline.ownerAvatar = ownerAvatar || timeline.ownerAvatar || '';
        root.phones[hit[0]] = timeline;
        return {root,key:hit[0],timeline};
    }
    if (!create) return null;
    const key = `latent:${slug(name)}`;
    const timeline = defaultTimeline(name, ownerAvatar || charAvatar(name));
    root.phones[key] = timeline;
    return {root,key,timeline};
}
function findContact(t, name) {
    return Object.values(t?.contacts || {}).find(c => lc(c?.name) === lc(name) || lc(c?.nickname) === lc(name)) || null;
}
function ensureContact(t, name) {
    name = norm(name);
    if (!name) return null;
    let contact = findContact(t,name);
    if (contact) {
        contact.name ||= name;
        contact.avatar ||= charAvatar(name);
        const identity = globalThis.GreyhavenPhone?.getIdentityByName?.(name);
        contact.identityId ||= identity?.id || '';
        contact.phoneNumber ||= identity?.phoneNumber || '';
        return contact;
    }
    const found = findCharacter(name);
    const identity = globalThis.GreyhavenPhone?.getIdentityByName?.(name);
    const cid = `contact:${uid()}`;
    contact = {
        id:cid, name, avatar:charAvatar(name),
        characterId:found?.index ?? null,
        personaDescription:'',
        identityId:identity?.id || '',phoneNumber:identity?.phoneNumber || '',saved:false,
        source:'world-bridge', favorite:false,
        blocked:false, blockedByContact:false, ignoringOwner:false,
        boundaryLevel:0, muted:false, locationSharing:'precise', nickname:'',
    };
    t.contacts[cid] = contact;
    t.contactOrder ||= [];
    t.contactOrder.push(cid);
    return contact;
}
function saveExplicitContact(ownerName,targetName,source='exchange') {
    const api = globalThis.GreyhavenPhone;
    if (typeof api?.saveContactForOwner === 'function') return api.saveContactForOwner(ownerName,targetName,{source});
    const box=phoneForOwner(ownerName,charAvatar(ownerName),true),contact=box?ensureContact(box.timeline,targetName):null;
    if (!box || !contact) return null;contact.saved=true;contact.source=source;box.timeline.suppressedContacts=(box.timeline.suppressedContacts||[]).filter(x=>x!==lc(targetName));box.root.phones[box.key]=box.timeline;saveRoot(box.root);return contact;
}
function ensureThread(t, peerName) {
    const contact = ensureContact(t,peerName);
    if (!contact) return null;
    let th = Object.values(t.threads || {}).find(x =>
        x?.type === 'direct' && Array.isArray(x.contactIds) &&
        x.contactIds.length === 1 && x.contactIds[0] === contact.id
    );
    if (!th) {
        th = {
            id:`thread:${uid()}`, type:'direct',
            title:contact.nickname || contact.name,
            contactIds:[contact.id], createdAt:Date.now(), messages:[],
        };
        t.threads[th.id] = th;
        t.threadOrder ||= [];
        t.threadOrder.unshift(th.id);
    }
    if (!Array.isArray(th.messages)) th.messages = [];
    return {contact,thread:th};
}
function pushNotification(t, peer, thread, message) {
    t.notifications ||= [];
    t.notifications.unshift({
        id:uid(), app:'messages',
        title:peer?.nickname || peer?.name || message.sender,
        text:message.type === 'photo' ? (message.text || 'Photo')
            : message.type === 'video' ? (message.text || 'Video')
            : message.text || 'New message',
        timeMs:message.timeMs, read:false, targetId:thread.id,
    });
}
function makeMessage({
    sender,text,timeMs,mirrorId,read=true,deliveryState='sent',
    type='text',mediaDescription='',
}) {
    const safeType = ['photo','video'].includes(lc(type)) ? lc(type) : 'text';
    return {
        id:uid(), sender:norm(sender), senderId:'',
        text:String(text || ''), timeMs:Number(timeMs || rpNowMs()),
        realMs:Date.now(), read:read !== false, type:safeType,
        mediaDescription:safeType === 'text' ? '' : String(mediaDescription || ''),
        mediaKey:'', mediaWidth:0, mediaHeight:0,
        requestMedia:'', mirrorId:String(mirrorId || uid()),
        editedAt:0, deliveryState,
    };
}
function appendMessageToPhone(box, peerName, message, {incoming=false}={}) {
    const info = ensureThread(box.timeline,peerName);
    if (!info) return null;
    if (message.mirrorId && info.thread.messages.some(m => m?.mirrorId === message.mirrorId)) return info.thread;
    const copy = clone(message);
    copy.id = uid();
    copy.senderId = incoming ? info.contact.id : 'owner';
    copy.read = !incoming;
    info.thread.messages.push(copy);
    if (incoming) pushNotification(box.timeline,info.contact,info.thread,copy);
    box.timeline.updatedAt = Date.now();
    box.root.phones[box.key] = box.timeline;
    return info.thread;
}
function phoneBlockState(ownerName, peerName) {
    const box = phoneForOwner(ownerName,'',false);
    const c = box ? findContact(box.timeline,peerName) : null;
    return c ? {
        blocked:!!c.blocked,
        blockedByContact:!!c.blockedByContact,
        ignoringOwner:!!c.ignoringOwner,
        boundaryLevel:Number(c.boundaryLevel||0),
    } : {blocked:false,blockedByContact:false,ignoringOwner:false,boundaryLevel:0};
}
function syncBlock(blockerName, blockedName, blocked=true) {
    const a = phoneForOwner(blockerName,charAvatar(blockerName),true);
    const b = phoneForOwner(blockedName,charAvatar(blockedName),true);
    if (!a || !b) return;
    const target = ensureContact(a.timeline,blockedName);
    const blocker = ensureContact(b.timeline,blockerName);
    if (target) {
        target.blocked = !!blocked;
        target.ignoringOwner = false;
    }
    if (blocker) {
        blocker.blockedByContact = !!blocked;
        blocker.ignoringOwner = false;
    }
    a.timeline.updatedAt = Date.now();
    b.timeline.updatedAt = Date.now();
    a.root.phones[a.key] = a.timeline;
    a.root.phones[b.key] = b.timeline;
    saveRoot(a.root);
}
function appendContinuity(root, data={}) {
    root.continuity ||= defaultContinuity();
    root.continuity.events ||= [];
    const mirrorId = String(data.mirrorId || '');
    if (mirrorId && root.continuity.events.some(e => e?.mirrorId === mirrorId)) return;
    const summary = String(data.summary || '').trim();
    if (!summary) return;
    const event = {
        id:uid(), seq:++root.continuity.seq,
        kind:['message','call','media','social'].includes(data.kind) ? data.kind : 'message',
        participants:[...new Set((data.participants || []).map(norm).filter(Boolean))],
        sender:norm(data.sender || ''),
        summary,
        threadTitle:String(data.threadTitle || ''),
        mirrorId,
        roleplayMs:Number(data.roleplayMs || rpNowMs()),
        realMs:Date.now(),
        persistent:data.persistent === true,
        transient:data.transient === true,
    };
    root.continuity.events.push(event);
    root.continuity.events = root.continuity.events.slice(-180);
}

/* ---------------- World event materialization ---------------- */

function wasProcessed(eventId) {
    const root = phoneRoot(false);
    return !!root?.worldBridge?.processed?.includes(String(eventId));
}
function markProcessed(eventId) {
    const root = phoneRoot();
    if (!root) return;
    root.worldBridge.processed ||= [];
    const key = String(eventId || '');
    if (key && !root.worldBridge.processed.includes(key)) root.worldBridge.processed.push(key);
    saveRoot(root);
}
function mirrorText(from,to,text,timeMs,mirrorId,continuityKind='message') {
    const sender = phoneForOwner(from,charAvatar(from),true);
    const recipient = phoneForOwner(to,charAvatar(to),true);
    if (!sender || !recipient) return {delivered:false};

    const senderPeer = ensureContact(sender.timeline,to);
    const recipientPeer = ensureContact(recipient.timeline,from);
    const blockedByRecipient = !!senderPeer?.blockedByContact || !!recipientPeer?.blocked;
    const message = makeMessage({
        sender:from,text,timeMs,mirrorId,read:true,
        deliveryState:blockedByRecipient ? 'not-delivered' : 'sent',
    });

    appendMessageToPhone(sender,to,message,{incoming:false});
    if (!blockedByRecipient) appendMessageToPhone(recipient,from,message,{incoming:true});

    sender.timeline.updatedAt = Date.now();
    recipient.timeline.updatedAt = Date.now();
    sender.root.phones[sender.key] = sender.timeline;
    sender.root.phones[recipient.key] = recipient.timeline;

    appendContinuity(sender.root,{
        kind:continuityKind, participants:[from,to], sender:from,
        summary:`${from}: ${text}`, threadTitle:to,
        mirrorId, roleplayMs:timeMs, transient:false,
    });
    saveRoot(sender.root);
    return {delivered:!blockedByRecipient, mirrorId, sender, recipient};
}
function mirrorMedia(from,to,mediaType,description,caption,timeMs,mirrorId) {
    const sender = phoneForOwner(from,charAvatar(from),true);
    const recipient = phoneForOwner(to,charAvatar(to),true);
    if (!sender || !recipient) return {delivered:false};

    const safeType = ['photo','video'].includes(lc(mediaType)) ? lc(mediaType) : '';
    const mediaDescription = norm(description);
    const mediaCaption = norm(caption);
    if (!safeType || !mediaDescription) return {delivered:false};

    const senderPeer = ensureContact(sender.timeline,to);
    const recipientPeer = ensureContact(recipient.timeline,from);
    const blockedByRecipient = !!senderPeer?.blockedByContact || !!recipientPeer?.blocked;
    const message = makeMessage({
        sender:from,text:mediaCaption,timeMs,mirrorId,read:true,
        deliveryState:blockedByRecipient ? 'not-delivered' : 'sent',
        type:safeType,mediaDescription,
    });

    appendMessageToPhone(sender,to,message,{incoming:false});
    if (!blockedByRecipient) appendMessageToPhone(recipient,from,message,{incoming:true});

    sender.timeline.updatedAt = Date.now();
    recipient.timeline.updatedAt = Date.now();
    sender.root.phones[sender.key] = sender.timeline;
    sender.root.phones[recipient.key] = recipient.timeline;

    const label = safeType === 'video' ? 'video' : 'photo';
    appendContinuity(sender.root,{
        kind:'media', participants:[from,to], sender:from,
        summary:`${from} sent ${to} a ${label}: ${mediaDescription}${mediaCaption ? ` | Caption: ${mediaCaption}` : ''}`,
        threadTitle:to, mirrorId, roleplayMs:timeMs, transient:false,
    });
    saveRoot(sender.root);
    return {delivered:!blockedByRecipient, mirrorId, sender, recipient, message};
}

function mirrorCall(from,to,timeMs,eventId) {
    const a = phoneForOwner(from,charAvatar(from),true);
    const b = phoneForOwner(to,charAvatar(to),true);
    if (!a || !b) return;
    const ca = ensureContact(a.timeline,to), cb = ensureContact(b.timeline,from);
    const blocked = !!ca?.blockedByContact || !!cb?.blocked;
    const sharedCallId = `world-call:${eventId || uid()}`;
    a.timeline.calls ||= [];
    a.timeline.calls.unshift({
        id:uid(),sharedCallId,contactId:ca.id,contactName:ca.name,
        direction:'outgoing',status:blocked?'Blocked':'Outgoing call',
        timeMs:Number(timeMs||rpNowMs()),durationSec:0,transcript:[],
    });
    if (!blocked) {
        b.timeline.calls ||= [];
        b.timeline.calls.unshift({
            id:uid(),sharedCallId,contactId:cb.id,contactName:cb.name,
            direction:'incoming',status:'Incoming call',
            timeMs:Number(timeMs||rpNowMs()),durationSec:0,transcript:[],
        });
        b.timeline.notifications ||= [];
        b.timeline.notifications.unshift({
            id:uid(),app:'phone',title:from,text:'Incoming call',
            timeMs:Number(timeMs||rpNowMs()),read:false,targetId:'',
        });
    }
    a.timeline.updatedAt = Date.now(); b.timeline.updatedAt = Date.now();
    a.root.phones[a.key] = a.timeline; a.root.phones[b.key] = b.timeline;
    appendContinuity(a.root,{
        kind:'call',participants:[from,to],sender:from,
        summary:`${from} called ${to}.`,threadTitle:to,mirrorId:sharedCallId,
        roleplayMs:Number(timeMs||rpNowMs()),persistent:false,transient:true,
    });
    saveRoot(a.root);
}
async function materializeWorldEvent(event,{allowRelay=true}={}) {
    if (!event || typeof event !== 'object') return;
    const eid = String(event.id || event.sourceKey || '');
    if (eid && wasProcessed(eid)) return;
    const type = norm(event.type);
    const from = norm(event.actor || event.from);
    const to = norm(event.target || event.to);
    const known = name => !!(findCharacter(name) || lc(ctx()?.name1) === lc(name) || globalThis.GreyhavenPhone?.getIdentityByName?.(name));
    if (!from || !to || lc(from) === lc(to) || !known(from) || !known(to)) {
        if (eid) markProcessed(eid);
        return;
    }

    let relayCandidate = false;
    if (type === 'message.send') {
        const text = norm(event.text || event.data?.text || '');
        if (text) {
            const mirrorId = `world:${event.id || uid()}`;
            const result = mirrorText(from,to,text,Number(event.roleplayMs||rpNowMs()),mirrorId);
            relayCandidate = !!result.delivered;
        }
    } else if (type === 'media.send') {
        const mediaType = ['photo','video'].includes(lc(event.data?.mediaType))
            ? lc(event.data.mediaType) : '';
        const description = norm(event.data?.mediaDescription || event.data?.description || '');
        const caption = norm(event.data?.caption || event.text || '');
        if (mediaType && description) {
            const mirrorId = `world-media:${event.id || uid()}`;
            const result = mirrorMedia(
                from,to,mediaType,description,caption,
                Number(event.roleplayMs||rpNowMs()),mirrorId,
            );
            relayCandidate = !!result.delivered;
        }
    } else if (type === 'call.place') {
        mirrorCall(from,to,Number(event.roleplayMs||rpNowMs()),event.id);
    } else if (type === 'contact.block') {
        syncBlock(from,to,true);
    } else if (type === 'contact.unblock') {
        syncBlock(from,to,false);
    } else if (type === 'contact.add') {
        saveExplicitContact(from,to,'number');
    } else if (type === 'contact.exchange') {
        saveExplicitContact(from,to,'exchange');
        saveExplicitContact(to,from,'exchange');
    } else if (type === 'instagram.follow' || type === 'instagram.unfollow') {
        globalThis.GreyhavenPhone?.apps?.followInstagram?.(from,to,type === 'instagram.follow',{notify:true});
    } else if (type === 'snapchat.add' || type === 'snapchat.accept' || type === 'snapchat.decline') {
        const action = type === 'snapchat.add' ? 'request' : type === 'snapchat.accept' ? 'accept' : 'decline';
        globalThis.GreyhavenPhone?.apps?.requestSnapchat?.(from,to,action,{notify:action !== 'decline'});
    } else if (type === 'facebook.friend.request' || type === 'facebook.friend.accept' || type === 'facebook.friend.decline') {
        const action = type.endsWith('.request') ? 'request' : type.endsWith('.accept') ? 'accept' : 'decline';
        globalThis.GreyhavenPhone?.apps?.requestFacebook?.(from,to,action,{notify:action !== 'decline'});
    } else {
        if (eid) markProcessed(eid);
        return;
    }

    if (eid) markProcessed(eid);
    scheduleCalendarInjection();

    if (allowRelay && relayCandidate) {
        relayQueue = relayQueue
            .then(() => maybeGenerateOneHopReply(event))
            .catch(e => console.error('[greyhaven-phone-bridge] hidden relay',e));
    }
}

/* ---------------- One-hop reply ---------------- */

function relaySettings() {
    const life = globalThis.GreyhavenLife;
    let s = {};
    try { s = life?.getWorldBridgeSettings?.() || {}; } catch {}
    return {
        enabled:s.worldBridgeEnabled !== false,
        mode:['economy','smart','live'].includes(s.relayMode) ? s.relayMode : 'smart',
        tokens:Math.max(180,Math.min(700,Number(s.relayResponseTokens||DEFAULT_RELAY_TOKENS))),
    };
}
function looksReplyWorthy(text) {
    const s = norm(text);
    if (!s) return false;
    return /[?]\s*$/.test(s) ||
        /\b(?:where|when|what|why|how|who|which|can you|could you|would you|will you|are you|do you|did you|tell me|let me know|text me|reply|answer|send me|ask him|ask her|invite|unblock)\b/i.test(s);
}
function exactThreadTail(ownerName,peerName,limit=12) {
    const box = phoneForOwner(ownerName,'',false);
    if (!box) return [];
    const info = ensureThread(box.timeline,peerName);
    if (!info) return [];
    return info.thread.messages.slice(-limit).map(m => {
        const kind = m.type && m.type !== 'text'
            ? `${m.type.toUpperCase()} ${m.mediaDescription || ''}${m.text ? ` | Caption: ${m.text}` : ''}` : m.text;
        return {
            sender:m.sender, text:String(kind || '').slice(0,800),
            timeMs:Number(m.timeMs||0),
        };
    });
}
function compactLifeContext(participants) {
    const L = globalThis.GreyhavenLife;
    try {
        if (typeof L?.getContextBundle === 'function') {
            const b = L.getContextBundle({
                participants,rpMessages:18,rpChars:10000,eventLimit:28,
            });
            // Preserve useful evidence while bounding very large resolved-person payloads.
            return {
                time:b?.time, scene:b?.scene, scenario:b?.scenario || scenarioText(),
                snapshot:b?.snapshot,
                people:Array.isArray(b?.people) ? b.people.map(p => ({
                    name:p?.name,present:p?.present,
                    location:p?.resolved?.location || p?.base?.location || p?.location || '',
                    area:p?.resolved?.area || p?.base?.area || p?.area || '',
                    status:p?.resolved?.status || p?.base?.status || p?.status || '',
                    availability:p?.resolved?.availability || p?.base?.availability || p?.availability || '',
                })) : [],
                schedules:b?.schedules || [],
                oneTimePlans:b?.oneTimePlans || [],
                worldEvents:b?.worldEvents || [],
                recentRoleplay:b?.recentRoleplay || recentRoleplay(),
            };
        }
    } catch (e) {
        console.warn('[greyhaven-phone-bridge] Life context',e);
    }
    return {
        time:new Date(rpNowMs()).toISOString(),
        scene:null, scenario:scenarioText(), snapshot:null, people:[],
        schedules:[],oneTimePlans:[],worldEvents:[],recentRoleplay:recentRoleplay(),
    };
}
function parseRelay(raw) {
    let s = String(raw || '').trim().replace(/^```(?:text)?\s*/i,'').replace(/\s*```$/,'').trim();
    if (!s) return {kind:'IGNORE',text:''};
    if (/^IGNORE\b/i.test(s)) return {kind:'IGNORE',text:''};
    if (/^BLOCK\b/i.test(s)) return {kind:'BLOCK',text:''};
    s = s.replace(/^TEXT\s*:\s*/i,'').trim();
    // One hidden relay is one message, not a novella.
    if (s.length > 1600) s = s.slice(0,1600).trim();
    return s ? {kind:'TEXT',text:s} : {kind:'IGNORE',text:''};
}
async function maybeGenerateOneHopReply(event) {
    const settings = relaySettings();
    if (!settings.enabled || settings.mode === 'economy') return;

    const from = norm(event.actor), to = norm(event.target);
    // Delivery is still committed above, but the person currently controlled by
    // the user must answer manually from their own phone/persona.
    if (to && lc(to) === lc(ctx()?.name1)) return;
    const eventType = norm(event.type);
    const isMedia = eventType === 'media.send';
    const mediaType = isMedia && ['photo','video'].includes(lc(event.data?.mediaType))
        ? lc(event.data.mediaType) : '';
    const mediaDescription = isMedia
        ? norm(event.data?.mediaDescription || event.data?.description || '') : '';
    const mediaCaption = isMedia ? norm(event.data?.caption || event.text || '') : '';
    const text = isMedia
        ? `[${mediaType ? mediaType.toUpperCase() : 'MEDIA'}: ${mediaDescription || 'media'}]${mediaCaption ? ` Caption: ${mediaCaption}` : ''}`
        : norm(event.text);
    if (!from || !to || !text) return;
    const replyWorthy = isMedia
        ? (event.data?.expectsReply === true || looksReplyWorthy(mediaCaption))
        : (event.data?.expectsReply === true || looksReplyWorthy(text));
    if (settings.mode === 'smart' && !replyWorthy) return;

    // A hidden relay must target an actual character card. This prevents inventing
    // autonomous responses for a persona-only or unknown person.
    const targetCard = cardData(to);
    if (!targetCard) return;
    const targetIdentity = globalThis.GreyhavenPhone?.getIdentityByName?.(to) || null;

    const targetState = phoneBlockState(to,from);
    if (targetState.blocked) return;
    if (targetState.ignoringOwner) {
        globalThis.GreyhavenLife?.recordWorldEvent?.({
            type:'message.ignored',actor:to,target:from,participants:[from,to],
            app:'messages',summary:`${to} left ${from}'s message unanswered.`,
            roleplayMs:rpNowMs(),realMs:Date.now(),source:'world-relay',
            sourceKey:`relay-ignore:${event.id}`,persistent:false,transient:true,
        });
        return;
    }

    const sender = speakerData(from);
    const life = compactLifeContext([from,to]);
    const thread = exactThreadTail(to,from,12);
    const systemPrompt = `You are producing ONE private phone response AS ${to} TO ${from} for a realistic ongoing roleplay.

IDENTITY LOCK:
- You are ${to}. Never claim to be ${from}, the user's persona, or another character.
- ${from} is the person who sent the newest message.
- Preserve names exactly and never invent, expand, or guess a surname.
- ${to}'s authoritative phone number is ${targetIdentity?.phoneNumber || 'unavailable'}. If asked for their own number, use that exact 9-digit value and never invent another.
- Preserve ${to}'s own personality, relationship, vocabulary, boundaries, emotions, slang, emoji habits, maturity and texting style from the character data and conversation.
- Do not become formal/therapeutic/generic unless ${to} truly speaks that way.
- A close friend/partner may be casual, messy, teasing, affectionate, profane or emoji-heavy when natural. A stranger may be colder.
- Respect current world facts and chronology. A phone text does not teleport anyone.
- If ${to} is angry, hurt, busy, ignoring ${from}, or the relationship makes silence more realistic, IGNORE is valid.
- BLOCK is only for a genuinely block-worthy escalation or an already-established decision to block.
- This relay may create AT MOST ONE response. Never simulate ${from}'s next reply and never continue the conversation yourself.
- Do not send a photo/video in this hidden relay; media remains an interactive Phone action.

OUTPUT EXACTLY ONE:
TEXT: <one natural message from ${to}>
IGNORE
BLOCK`;

    const prompt = `FICTIONAL TIME: ${new Date(rpNowMs()).toString()}

${to} CHARACTER:
${JSON.stringify({...targetCard,phoneNumber:targetIdentity?.phoneNumber || ''})}

${from} CONTEXT:
${JSON.stringify(sender)}

CHAT-SPECIFIC SCENARIO:
${life.scenario || '(none)'}

GREYHAVEN LIFE / WORLD:
${JSON.stringify({
    time:life.time,scene:life.scene,snapshot:life.snapshot,
    people:life.people,schedules:life.schedules,
    oneTimePlans:life.oneTimePlans,worldEvents:life.worldEvents,
})}

RECENT REAL-LIFE ROLEPLAY:
${life.recentRoleplay || '(none)'}

PRIVATE ${to} ↔ ${from} THREAD, OLDEST TO NEWEST:
${thread.length ? thread.map(x=>`[${roleplayTimeText(x.timeMs)}] ${x.sender}: ${x.text}`).join('\n') : '(no earlier thread messages)'}

NEWEST PRIVATE PHONE ACTION FROM ${from}:
${isMedia ? `${from} sent a ${mediaType || 'media item'} showing: ${mediaDescription || '(description unavailable)'}${mediaCaption ? `\nCaption: ${mediaCaption}` : ''}` : text}

Decide whether ${to} naturally texts once, leaves it unanswered, or blocks.`;

    const c = ctx();
    if (typeof c?.generateRaw !== 'function') return;
    const raw = await c.generateRaw({
        prompt,systemPrompt,responseLength:settings.tokens,trimNames:false,
    });
    const parsed = parseRelay(raw);

    if (parsed.kind === 'BLOCK') {
        syncBlock(to,from,true);
        globalThis.GreyhavenLife?.recordWorldEvent?.({
            type:'contact.block',actor:to,target:from,participants:[from,to],
            app:'messages',summary:`${to} blocked ${from}.`,
            roleplayMs:rpNowMs(),realMs:Date.now(),source:'world-relay',
            sourceKey:`relay-block:${event.id}`,persistent:true,transient:false,
        });
        return;
    }
    if (parsed.kind === 'IGNORE') {
        globalThis.GreyhavenLife?.recordWorldEvent?.({
            type:'message.ignored',actor:to,target:from,participants:[from,to],
            app:'messages',summary:`${to} did not reply to ${from}'s message.`,
            roleplayMs:rpNowMs(),realMs:Date.now(),source:'world-relay',
            sourceKey:`relay-ignore:${event.id}`,persistent:false,transient:true,
        });
        return;
    }

    const replyTime = Math.max(rpNowMs(),Number(event.roleplayMs||0));
    const mirrorId = `world-reply:${event.id || uid()}`;
    const result = mirrorText(to,from,parsed.text,replyTime,mirrorId,'message');
    if (!result.delivered) return;

    globalThis.GreyhavenLife?.recordWorldEvent?.({
        type:'message.reply',actor:to,target:from,participants:[from,to],
        app:'messages',text:parsed.text,
        summary:`${to} replied privately to ${from}: ${parsed.text}`,
        roleplayMs:replyTime,realMs:Date.now(),source:'world-relay',
        sourceKey:`relay-reply:${event.id}`,persistent:false,transient:false,
        data:{parentEventId:event.id,relayDepth:1},
    });
}

/* ---------------- Calendar: Greyhaven Life one-time plans ---------------- */

function planState(plan, nowMs=rpNowMs()) {
    if (plan?.state && plan.state !== 'planned') return plan.state;
    if (Number(plan?.startMs||0) <= nowMs && Number(plan?.endMs||0) >= nowMs) return 'active';
    if (Number(plan?.endMs||0) < nowMs) return 'past';
    return 'upcoming';
}
function calendarPlanHtml(plan) {
    const state = planState(plan);
    const loc = [norm(plan.location),norm(plan.area)].filter(Boolean).join(' · ');
    const time = `${roleplayTimeText(plan.startMs)} → ${roleplayTimeText(plan.endMs)}`;
    const meta = [time,loc,plan.status,plan.state && plan.state !== 'planned' ? plan.state : '']
        .map(norm).filter(Boolean).join(' · ');
    return `<div class="ghp-event ghpb-plan ${state==='active'?'current':''}">
        <i></i><span><b>${esc(plan.title || 'Plan')}</b><small>${esc(meta)}</small></span>
    </div>`;
}
function injectCalendarPlans() {
    const overlay = document.querySelector('#ghp-overlay');
    if (!overlay || overlay.hidden) return;
    const header = overlay.querySelector('.ghp-app-header b');
    if (norm(header?.textContent) !== 'Calendar') return;
    const main = overlay.querySelector('.ghp-app > main');
    if (!main || main.querySelector('#ghpb-one-time-calendar')) return;

    const owner = norm(ctx()?.name1 || globalThis.GreyhavenPhone?.getActivePersona?.()?.name || '');
    if (!owner) return;
    let plans = [];
    try {
        const nowMs = rpNowMs();
        plans = globalThis.GreyhavenLife?.getOneTimePlans?.(owner,{
            fromMs:nowMs - 7*86400000,toMs:nowMs + 30*86400000,
        }) || [];
    } catch {}
    if (!plans.length) return;

    const nowMs = rpNowMs();
    plans = [...plans].sort((a,b) => {
        const sa = planState(a,nowMs), sb = planState(b,nowMs);
        const rank = {active:0,upcoming:1,past:2,completed:2,missed:3,cancelled:4};
        return (rank[sa]??9)-(rank[sb]??9) || Number(a.startMs||0)-Number(b.startMs||0);
    }).slice(0,16);

    const section = document.createElement('section');
    section.id = 'ghpb-one-time-calendar';
    section.innerHTML = `<h3>Plans & events</h3>${plans.map(calendarPlanHtml).join('')}`;
    const nowSection = [...main.querySelectorAll(':scope > section')].find(x =>
        norm(x.querySelector('h3')?.textContent) === 'Now'
    );
    if (nowSection?.nextSibling) main.insertBefore(section,nowSection.nextSibling);
    else {
        const firstSection = main.querySelector(':scope > section');
        if (firstSection) main.insertBefore(section,firstSection);
        else main.appendChild(section);
    }
}
function scheduleCalendarInjection() {
    if (calendarQueued) return;
    calendarQueued = true;
    requestAnimationFrame(() => {
        calendarQueued = false;
        injectCalendarPlans();
    });
}
function watchUi() {
    if (uiObserver) return;
    uiObserver = new MutationObserver(scheduleCalendarInjection);
    uiObserver.observe(document.body,{childList:true,subtree:true});
}

/* ---------------- Initialization / API ---------------- */

function reconcileExistingWorldEvents() {
    let events = [];
    try {
        events = globalThis.GreyhavenLife?.getWorldEvents?.({limit:80}) || [];
    } catch {}
    for (const e of events) {
        if (!['message.send','media.send','call.place','contact.block','contact.unblock','contact.add','contact.exchange','instagram.follow','instagram.unfollow','snapchat.add','snapchat.accept','snapchat.decline','facebook.friend.request','facebook.friend.accept','facebook.friend.decline'].includes(norm(e?.type))) continue;
        if (e.id && wasProcessed(e.id)) continue;
        // Reconciliation should materialize old RP actions but never spend tokens
        // merely because the extension/page was reloaded.
        Promise.resolve(materializeWorldEvent(e,{allowRelay:false}))
            .catch(err=>console.warn('[greyhaven-phone-bridge] reconcile',err));
    }
}
function exposeApi() {
    const phone = globalThis.GreyhavenPhone;
    if (!phone) return;
    Object.assign(phone,{
        version:BRIDGE_VERSION,
        coreVersion:CORE_VERSION,
        worldBridgeVersion:1,
        materializeWorldEvent:event=>materializeWorldEvent(event,{allowRelay:false}),
        getWorldBridgeStats:()=>{
            const root=phoneRoot(false);
            return {
                processed:root?.worldBridge?.processed?.length || 0,
                phoneCount:Object.keys(root?.phones || {}).length,
            };
        },
    });
}
function bindEvents() {
    if (bound) return;
    window.addEventListener('greyhaven-world-action', e => {
        Promise.resolve(materializeWorldEvent(e.detail,{allowRelay:true}))
            .catch(err=>console.error('[greyhaven-phone-bridge] world action',err));
    });
    window.addEventListener('greyhaven-life:changed',scheduleCalendarInjection);
    window.addEventListener('greyhaven-life:tick',scheduleCalendarInjection);

    const c = ctx();
    if (c?.eventSource && c?.eventTypes) {
        const bind = (key,fn) => {
            const name = c.eventTypes[key];
            if (name) c.eventSource.on(name,fn);
        };
        bind('CHAT_CHANGED',()=>setTimeout(()=>{reconcileExistingWorldEvents();scheduleCalendarInjection();},80));
        bind('CHAT_CREATED',()=>setTimeout(()=>{reconcileExistingWorldEvents();scheduleCalendarInjection();},80));
        bind('PERSONA_CHANGED',()=>setTimeout(scheduleCalendarInjection,80));
    }
    bound = true;
}
function injectStyle() {
    if (document.querySelector('#ghpb-style')) return;
    const s = document.createElement('style');
    s.id='ghpb-style';
    s.textContent=`
#ghpb-one-time-calendar{margin-top:18px}
#ghpb-one-time-calendar .ghpb-plan.current{box-shadow:inset 3px 0 0 rgba(95,215,199,.9)}
#ghpb-one-time-calendar .ghp-event small{white-space:normal}
`;
    document.head.appendChild(s);
}
async function initBridge() {
    if (ready) return;
    for (let i=0;i<240;i++) {
        if (globalThis.GreyhavenPhone && globalThis.GreyhavenLife && ctx()?.chatMetadata) break;
        await new Promise(r=>setTimeout(r,50));
    }
    if (!globalThis.GreyhavenPhone) {
        console.error('[greyhaven-phone-bridge] Greyhaven Phone core did not initialize.');
        return;
    }
    if (!globalThis.GreyhavenLife) {
        console.warn('[greyhaven-phone-bridge] Greyhaven Life is not loaded; world bridge waits for it.');
    }
    injectStyle();
    watchUi();
    bindEvents();
    exposeApi();
    reconcileExistingWorldEvents();
    scheduleCalendarInjection();
    ready = true;
    console.info(`[greyhaven-phone-bridge] v${BRIDGE_VERSION} ready on core ${CORE_VERSION}`);
}
initBridge().catch(e=>console.error('[greyhaven-phone-bridge] init failed',e));
