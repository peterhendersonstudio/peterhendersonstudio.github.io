        /**
 * ANTI-DOWNLOAD LOCK
 */
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
    if (e.ctrlKey && (e.key === 's' || e.key === 'u')) e.preventDefault();
});

document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (isTyping) return;

    if (currentLayer === 'detail') {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateDetail(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateDetail(1);
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
            e.preventDefault();
            handleBack();
        }
    } else if (currentLayer === 'home' || currentLayer === 'location') {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateSnapList(-1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateSnapList(1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            openActiveSnapItem();
        } else if (currentLayer === 'location' && (e.key === 'Escape' || e.key === 'Backspace')) {
            e.preventDefault();
            handleBack();
        }
    }
});

let rawSheetData = [];
let curCat, curReg, curSub, currentAlbum, currentIndex, currentLayer = 'home';
let archives = [];
let hoverInterval = null;
let observer = null;
const directCategoryAlbums = new Set(['Wildlife']);
let directBackFilter = null;
const navHoverCloseTimers = new WeakMap();
const showPlateAnnotations = false;
let mobileViewerTouchStartX = 0;
let mobileViewerTouchStartY = 0;

// DOM Anchors
const homeLayer = document.getElementById('layer-home');
const locLayer = document.getElementById('layer-location');
const detailLayer = document.getElementById('layer-detail');
const progressBar = document.getElementById('progress-bar');
const aboutDiv = document.getElementById('detail-about');
const textureDiv = document.getElementById('detail-texture-analysis');
const plaqueContainer = document.getElementById('plaque-container');
const detailHeroWrapper = document.getElementById('detail-hero-wrapper');
const mobileImageViewer = document.getElementById('mobile-image-viewer');
const mobileViewerImg = document.getElementById('mobile-viewer-img');
const mobileViewerNative = document.getElementById('mobile-viewer-native');
const mobileViewerTitle = document.getElementById('mobile-viewer-title');

function initializeArchive(data) {
    rawSheetData = data;
    processSheetData();
    renderHUD();
    // Initialize with Landscape -> South Island active on first load
    filterGallery('Landscape', 'South Island');
}

// Fetch and mount the archive data collection safely
fetch('data/archive.json')
  .then(response => {
      if (!response.ok) throw new Error("Network error fetching JSON");
      return response.json();
  })
  .then(initializeArchive)
  .catch(error => {
      console.error("Archive Data Error:", error);
      if (Array.isArray(window.PH_ARCHIVE_DATA)) {
          initializeArchive(window.PH_ARCHIVE_DATA);
          return;
      }
      if (homeLayer) {
          homeLayer.classList.remove('hidden');
          homeLayer.innerHTML = `<div class="w-full h-screen flex items-center justify-center px-8 text-center font-sans text-[10px] tracking-[0.25em] text-red-500 uppercase">System Error: archive data could not be loaded. Open the site through a local server or check the browser console.</div>`;
      }
  });

function getImagePath(folder, filename) {
    return encodeURI(`images/${folder}/${filename}`);
}

function supportsHoverPreview() {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches && !navigator.connection?.saveData;
}

function getPreviewFile(plate) {
    return plate["Physical Preview"] || plate["Physical Master"];
}

function getMasterFile(plate) {
    return plate["Physical Master"] || plate["Physical Preview"];
}

function parsePos(val) {
    if (!val || val === 'center' || val === '0R 0') return '50% 50%';
    let h = 50;
    let v = 50;

    val.split(' ').forEach(part => {
        const amount = parseInt(part, 10);
        if (Number.isNaN(amount)) return;
        if (part.includes('R')) h += amount;
        else if (part.includes('L')) h -= amount;
        else if (part.startsWith('+')) v -= amount;
        else if (part.startsWith('-')) v += Math.abs(amount);
    });

    return `${h}% ${v}%`;
}

function parseList(value) {
    if (!value || value.toString().trim().toLowerCase() === 'nan') return [];
    return value.toString().split(',').map(item => item.trim()).filter(Boolean);
}

function formatRef(index) {
    return `#${index + 1}`;
}

function formatSubLabel(cat, sub) {
    if (cat === 'Birds' && sub === 'New Zealand Birds') return 'NEW ZEALAND';
    if (sub === 'South Island') return 'SOUTH ISLAND / TE WAIPOUNAMU';
    if (sub === 'North Island') return 'NORTH ISLAND / TE IKA-A-MĀUI';
    return sub.toUpperCase();
}

function formatRegionLabel(region) {
    if (region === 'Aotearoa New Zealand') return 'AOTEAROA NEW ZEALAND';
    return region.toUpperCase();
}

function slugClass(value) {
    return (value || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function classifyAspect(width, height) {
    if (!width || !height) return 'standard';
    const ratio = width / height;
    if (ratio >= 2.25) return 'panorama';
    if (ratio <= 0.82) return 'portrait';
    if (ratio <= 1.12) return 'square';
    return 'standard';
}

function updateDetailAspect(img, category) {
    const frame = detailLayer?.querySelector('.exhibition-frame');
    if (!frame || !img) return;

    frame.classList.remove(
        'detail-aspect-panorama',
        'detail-aspect-portrait',
        'detail-aspect-square',
        'detail-aspect-standard',
        'detail-category-birds'
    );

    frame.classList.add(`detail-aspect-${classifyAspect(img.naturalWidth, img.naturalHeight)}`);
    if (category === 'Birds') frame.classList.add('detail-category-birds');
    img.classList.add('is-loaded');
}

function observeSections(container) {
    if (!window.IntersectionObserver || !container) return;
    if (!observer) {
        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                entry.target.classList.toggle('is-active', entry.isIntersecting);
            });
        }, { threshold: 0.5 });
    }
    container.querySelectorAll('section').forEach(section => observer.observe(section));
}

function updateProgress(container) {
    if (!progressBar || !container) return;
    const height = container.scrollHeight - container.clientHeight;
    const scrolled = height > 0 ? (container.scrollTop / height) * 100 : 0;
    progressBar.style.height = `${scrolled}%`;
}

function getActiveSnapContainer() {
    if (currentLayer === 'home') return homeLayer;
    if (currentLayer === 'location') return locLayer;
    return null;
}

function getCenteredSnapItem(container) {
    if (!container) return null;
    const sections = Array.from(container.querySelectorAll('section'));
    if (sections.length === 0) return null;

    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + container.clientHeight / 2;
    return sections.reduce((closest, section) => {
        const rect = section.getBoundingClientRect();
        const sectionCenter = rect.top + rect.height / 2;
        const distance = Math.abs(sectionCenter - centerY);
        return !closest || distance < closest.distance ? { section, distance } : closest;
    }, null).section;
}

function navigateSnapList(direction) {
    const container = getActiveSnapContainer();
    if (!container) return;

    const sections = Array.from(container.querySelectorAll('section'));
    if (sections.length === 0) return;

    const current = getCenteredSnapItem(container) || sections[0];
    const currentIndex = Math.max(0, sections.indexOf(current));
    const nextIndex = Math.max(0, Math.min(sections.length - 1, currentIndex + direction));
    sections[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openActiveSnapItem() {
    const section = getCenteredSnapItem(getActiveSnapContainer());
    if (section) section.click();
}

[homeLayer, locLayer, detailLayer].forEach(layer => {
    if (layer) layer.addEventListener('scroll', () => updateProgress(layer));
});

// Parses raw data arrays into distinct exhibition collections
function processSheetData() {
    const albumsMap = {};
    
    rawSheetData.forEach(item => {
        const cat = item.Category || "Landscape";
        const reg = item.Region || "Aotearoa New Zealand";
        const sub = item["Sub-Region"] || "New Zealand"; 
        const folder = item["Folder ID"];
        
        if (!folder) return;
        
        const key = `${cat}|${reg}|${sub}|${folder}`;
        if (!albumsMap[key]) {
            albumsMap[key] = {
                category: cat,
                region: reg,
                subRegion: sub,
                folder: folder,
                imageFolder: item["Image Folder"] || folder,
                title: item["Exhibition Title"] || folder.toUpperCase(),
                nativeName: item["Native Name"] || "",
                plates: []
            };
        }
        albumsMap[key].plates.push(item);
    });
    
    archives = Object.values(albumsMap);
}

// Builds the slide-out navigation layout for both desktop and mobile modes
function renderHUD() {
    const navSystem = document.getElementById('portfolio-navigation-system');
    const mobileDrawer = document.getElementById('mobile-nav-drawer');
    if (!navSystem || !mobileDrawer) return;

    const categories = [...new Set(rawSheetData.map(item => item.Category || "Landscape"))];
    
    let desktopHtml = '';
    let mobileHtml = '<div class="mobile-drawer-inner">';

    categories.forEach(cat => {
        const itemsInCat = rawSheetData.filter(item => (item.Category || "Landscape") === cat);
        const subRegions = [...new Set(itemsInCat.map(item => item["Sub-Region"] || ""))].filter(Boolean);
        const regions = [...new Set(itemsInCat.map(item => item.Region || ""))].filter(Boolean);
        const isDirectCategory = directCategoryAlbums.has(cat);
        const usesCountryNavigation = cat === 'Birds';
        const defaultSub = usesCountryNavigation ? 'all' : (subRegions[0] || 'all');
        const defaultRegion = usesCountryNavigation ? (regions[0] || '') : (subRegions.length > 0 ? '' : (regions[0] || ''));

        desktopHtml += `<div class="nav-item-group group">`;
        desktopHtml += `<div class="sub-menu-drawer">`;

        if (isDirectCategory) {
            desktopHtml += ``;
        } else if (cat === 'Landscape' && subRegions.length > 0) {
            regions.forEach(reg => {
                desktopHtml += `<div class="nested-nav-group">`;
                desktopHtml += `<div class="nested-sub-menu">`;
                subRegions.sort().reverse().forEach(sub => {
                    desktopHtml += `<span class="sub-link" onclick="filterGallery('${cat}', '${sub}', '')">${formatSubLabel(cat, sub)}</span>`;
                });
                desktopHtml += `</div>`;
                desktopHtml += `<span class="sub-link region-link" onclick="filterGallery('${cat}', '${defaultSub}', '')">${formatRegionLabel(reg)}</span>`;
                desktopHtml += `</div>`;
            });
        } else if (usesCountryNavigation) {
            regions.forEach(reg => {
                desktopHtml += `<span class="sub-link" onclick="filterGallery('${cat}', 'all', '${reg}')">${formatRegionLabel(reg)}</span>`;
            });
        } else if (subRegions.length > 0) {
            subRegions.sort().reverse().forEach(sub => {
                desktopHtml += `<span class="sub-link" onclick="filterGallery('${cat}', '${sub}')">${formatSubLabel(cat, sub)}</span>`;
            });
        } else {
            regions.forEach(reg => {
                desktopHtml += `<span class="sub-link" onclick="filterGallery('${cat}', 'all', '${reg}')">${formatRegionLabel(reg)}</span>`;
            });
        }
        desktopHtml += `</div>`;
        desktopHtml += `<span class="nav-link main-trigger" data-category="${cat}" onclick="filterGallery('${cat}', '${defaultSub}', '${defaultRegion}')">${cat.toUpperCase()}</span>`;
        desktopHtml += `</div>`;

        mobileHtml += `<div class="mobile-menu-section">`;
        mobileHtml += `<div class="mobile-parent-toggle" onclick="${isDirectCategory ? `filterGallery('${cat}', '${defaultSub}', '${defaultRegion}'); toggleMobileMenu(false);` : 'toggleMobileAccordion(this)'}">${cat.toUpperCase()}</div>`;
        mobileHtml += `<div class="mobile-child-links">`;

        if (isDirectCategory) {
            mobileHtml += ``;
        } else if (cat === 'Landscape' && subRegions.length > 0) {
            regions.forEach(reg => {
                mobileHtml += `<div class="mobile-region-label">${formatRegionLabel(reg)}</div>`;
                subRegions.sort().reverse().forEach(sub => {
                    mobileHtml += `<div class="mobile-sub-link" onclick="filterGallery('${cat}', '${sub}'); toggleMobileMenu(false);">${formatSubLabel(cat, sub)}</div>`;
                });
            });
        } else if (usesCountryNavigation) {
            regions.forEach(reg => {
                mobileHtml += `<div class="mobile-sub-link" onclick="filterGallery('${cat}', 'all', '${reg}'); toggleMobileMenu(false);">${formatRegionLabel(reg)}</div>`;
            });
        } else if (subRegions.length > 0) {
            subRegions.sort().reverse().forEach(sub => {
                mobileHtml += `<div class="mobile-sub-link" onclick="filterGallery('${cat}', '${sub}'); toggleMobileMenu(false);">${formatSubLabel(cat, sub)}</div>`;
            });
        } else {
            regions.forEach(reg => {
                mobileHtml += `<div class="mobile-sub-link" onclick="filterGallery('${cat}', 'all', '${reg}'); toggleMobileMenu(false);">${formatRegionLabel(reg)}</div>`;
            });
        }
        mobileHtml += `</div></div>`;
    });

    mobileHtml += '</div>';
    navSystem.innerHTML = desktopHtml;
    mobileDrawer.innerHTML = mobileHtml;
    setupNavigationHoverGrace(navSystem);
}

function setupNavigationHoverGrace(navRoot) {
    navRoot.querySelectorAll('.nested-nav-group').forEach(group => {
        group.addEventListener('pointerenter', () => {
            const timer = navHoverCloseTimers.get(group);
            if (timer) clearTimeout(timer);
            group.classList.add('menu-open');
        });

        group.addEventListener('pointerleave', () => {
            const timer = setTimeout(() => {
                group.classList.remove('menu-open');
            }, 220);
            navHoverCloseTimers.set(group, timer);
        });
    });
}

function getFilteredAlbums() {
    return archives.filter(album => {
        if (album.category !== curCat) return false;
        if (curSub !== 'all' && album.subRegion !== curSub) return false;
        if (curReg && album.region !== curReg) return false;
        return true;
    });
}

function filterGallery(cat, sub = 'all', reg = '') {
    const previousFilter = {
        cat: curCat || 'Landscape',
        sub: curSub || 'South Island',
        reg: curReg || ''
    };
    curCat = cat;
    curSub = sub;
    curReg = reg;

    updateActiveNavigation();

    const filteredAlbums = getFilteredAlbums();
    if (directCategoryAlbums.has(cat) && filteredAlbums.length === 1) {
        directBackFilter = previousFilter.cat === cat
            ? { cat: 'Landscape', sub: 'South Island', reg: '' }
            : previousFilter;
        currentAlbum = filteredAlbums[0];
        switchLayer('location');
        renderLocation(currentAlbum);
        return;
    }

    directBackFilter = null;
    switchLayer('home');
    renderHome();
}

function updateActiveNavigation() {
    document.querySelectorAll('.main-trigger').forEach(trigger => {
        trigger.classList.toggle('active', trigger.dataset.category === curCat);
    });
}

function renderHome() {
    if (!homeLayer) return;
    
    const filteredAlbums = getFilteredAlbums();

    if (filteredAlbums.length === 0) {
        homeLayer.innerHTML = `<div class="w-full text-center py-40 font-sans text-[11px] tracking-[0.25em] text-neutral-500 uppercase">No exhibitions cataloged in this section</div>`;
        return;
    }

    let html = '';
    filteredAlbums.forEach((album, albumIdx) => {
        const firstPlate = album.plates[0];
        const secondPlate = album.plates[1];
        const firstImage = getPreviewFile(firstPlate);
        const secondImage = secondPlate ? getPreviewFile(secondPlate) : '';
        const firstLoading = albumIdx === 0 ? 'eager' : 'lazy';
        const firstPriority = albumIdx === 0 ? 'high' : 'auto';
        html += `
        <section id="folder-${album.folder}" class="snap-item category-${slugClass(album.category)} w-screen h-screen relative flex items-center justify-center overflow-hidden group select-none cursor-pointer" onclick="enterLocation('${album.folder}')">
            <div class="media-stage">
                <img class="img-layer home-img-1" src="${getImagePath(album.imageFolder, firstImage)}" loading="${firstLoading}" fetchpriority="${firstPriority}" decoding="async" style="object-position: ${parsePos(firstPlate["Framing Adjust"])}" alt="${album.title}">
                ${secondPlate ? `<img class="img-layer home-img-2" data-src="${getImagePath(album.imageFolder, secondImage)}" loading="lazy" decoding="async" style="object-position: ${parsePos(secondPlate["Framing Adjust"])}" alt="${album.title}">` : ''}
                <div class="glass-wall"></div>
            </div>
            <div class="caption-block">
                <p class="native-name">${album.nativeName}</p>
                <h2 class="archive-title">${album.title}</h2>
            </div>
        </section>`;
    });

    homeLayer.innerHTML = html;
    setupHoverCrossfades();
    observeSections(homeLayer);
}

function enterLocation(folderId) {
    const album = archives.find(a => a.folder === folderId);
    if (!album) return;
    toggleMobileMenu(false);
    currentAlbum = album;
    switchLayer('location');
    renderLocation(album);
}

function renderLocation(album) {
    if (!locLayer) return;
    
    let html = '';
    album.plates.forEach((plate, idx) => {
        const image = getPreviewFile(plate);
        const loading = idx === 0 ? 'eager' : 'lazy';
        const priority = idx === 0 ? 'high' : 'auto';
        html += `
        <section id="plate-${idx}" class="snap-item category-${slugClass(album.category)} w-screen h-screen relative flex items-center justify-center overflow-hidden group select-none cursor-pointer" onclick="openPlateView(${idx})">
            <div class="media-stage">
                <img class="img-layer zoom-on-hover" src="${getImagePath(album.imageFolder, image)}" loading="${loading}" fetchpriority="${priority}" decoding="async" style="object-position: ${parsePos(plate["Framing Adjust"])}" alt="${album.title}">
                <div class="glass-wall"></div>
            </div>
            <div class="caption-block">
                <p class="native-name">${plate["Native Name"] || album.nativeName}</p>
                <h2 class="archive-title">${plate["Exhibition Title"] || album.title} // ${formatRef(idx)}</h2>
            </div>
        </section>`;
    });
    
    locLayer.innerHTML = html;
    locLayer.scrollTop = 0;
    observeSections(locLayer);
}

function setupHoverCrossfades() {
    if (hoverInterval) clearInterval(hoverInterval);
    if (!supportsHoverPreview()) return;
    document.querySelectorAll('#layer-home section').forEach(section => {
        const img1 = section.querySelector('.home-img-1');
        const img2 = section.querySelector('.home-img-2');
        if (!img1 || !img2) return;
        
        section.addEventListener('mouseenter', () => {
            if (!img2.src && img2.dataset.src) img2.src = img2.dataset.src;
            img2.style.opacity = '1';
        });
        section.addEventListener('mouseleave', () => { img2.style.opacity = '0'; });
    });
}

function switchLayer(layerName) {
    currentLayer = layerName;
    document.body.dataset.layer = layerName;
    document.body.classList.toggle('is-detail-open', layerName === 'detail');
    homeLayer.classList.add('hidden');
    locLayer.classList.add('hidden');
    detailLayer.classList.add('hidden');
    
    const backBtn = document.getElementById('global-back');
    if (layerName === 'home') {
        homeLayer.classList.remove('hidden');
        if (backBtn) backBtn.style.display = 'none';
    } else if (layerName === 'location') {
        locLayer.classList.remove('hidden');
        if (backBtn) backBtn.style.display = 'block';
    } else if (layerName === 'detail') {
        detailLayer.classList.remove('hidden');
        if (backBtn) backBtn.style.display = 'block';
    }
}

function showHome() {
    switchLayer('home');
    renderHome();
}

function openDetailView(index) {
    if (!currentAlbum) return;
    renderDetail(currentAlbum, index);
}

function openPlateView(index) {
    if (!currentAlbum) return;
    if (isMobileViewport()) {
        currentIndex = index;
        openMobileImageViewer(index);
        return;
    }
    openDetailView(index);
}

function renderDetail(album, idx) {
    currentAlbum = album;
    currentIndex = idx;
    switchLayer('detail');

    const plate = album.plates[idx];
    const masterPath = getImagePath(album.imageFolder, getMasterFile(plate));
    const crops = showPlateAnnotations ? parseList(plate["Samples (Ordered List)"]) : [];
    const narrative = showPlateAnnotations && plate.Narrative ? plate.Narrative.toString().trim() : '';

    const frame = detailLayer?.querySelector('.exhibition-frame');
    if (frame) {
        frame.classList.remove('detail-aspect-panorama', 'detail-aspect-portrait', 'detail-aspect-square', 'detail-aspect-standard', 'detail-category-birds');
        frame.classList.add(album.category === 'Birds' ? 'detail-category-birds' : 'detail-aspect-standard');
    }

    if (!detailHeroWrapper) return;
    detailHeroWrapper.innerHTML = `<img src="${masterPath}" id="main-hero-img" class="hero-exhibition" style="object-position: ${parsePos(plate["Framing Adjust"])}" decoding="async" alt="${plate["Exhibition Title"] || album.title}" onclick="openMobileImageViewer(${idx})">`;
    const heroImg = document.getElementById('main-hero-img');
    if (heroImg) {
        if (heroImg.complete) updateDetailAspect(heroImg, album.category);
        heroImg.addEventListener('load', () => updateDetailAspect(heroImg, album.category), { once: true });
    }

    const nextPlate = album.plates[(idx + 1) % album.plates.length];
    const prevPlate = album.plates[(idx - 1 + album.plates.length) % album.plates.length];
    [nextPlate, prevPlate].forEach(adjacentPlate => {
        if (!adjacentPlate) return;
        const preload = new Image();
        preload.src = getImagePath(album.imageFolder, getMasterFile(adjacentPlate));
    });
    document.getElementById('plaque-native').textContent = plate["Native Name"] || album.nativeName;
    document.getElementById('plaque-english').textContent = `${plate["Exhibition Title"] || album.title} // ${formatRef(idx)}`;

    if (plaqueContainer) {
        plaqueContainer.style.paddingBottom = (narrative || crops.length > 0) ? '2rem' : '12rem';
    }

    if (aboutDiv) {
        if (narrative) {
            aboutDiv.innerHTML = `<p class="about-text">${narrative}</p>`;
            aboutDiv.style.display = 'block';
        } else {
            aboutDiv.style.display = 'none';
        }
    }

    if (textureDiv) {
        if (crops.length > 0) {
            let textureHtml = `<div class="w-full border-t border-white/5 mt-12 mb-20"></div><div class="texture-strip">`;
            crops.forEach((sampleName, sampleIdx) => {
                textureHtml += `<div class="sample-box"><img src="${getImagePath(album.imageFolder, sampleName)}" class="sample-img" alt=""><p class="sample-label">Sample S-0${sampleIdx + 1}</p></div>`;
            });
            textureHtml += `</div>`;
            textureDiv.innerHTML = textureHtml;
            textureDiv.style.display = 'block';
        } else {
            textureDiv.style.display = 'none';
        }
    }
}

function handleBack() {
    if (mobileImageViewer?.classList.contains('is-open')) {
        closeMobileImageViewer();
        return;
    }
    if (currentLayer === 'detail') switchLayer('location');
    else if (currentLayer === 'location') {
        if (directBackFilter) {
            curCat = directBackFilter.cat;
            curSub = directBackFilter.sub;
            curReg = directBackFilter.reg;
            directBackFilter = null;
            switchLayer('home');
            updateActiveNavigation();
            renderHome();
            return;
        }
        switchLayer('home');
    }
}

function navigateDetail(direction) {
    if (!currentAlbum) return;
    let nextIdx = currentIndex + direction;
    if (nextIdx < 0) nextIdx = currentAlbum.plates.length - 1;
    else if (nextIdx >= currentAlbum.plates.length) nextIdx = 0;
    renderDetail(currentAlbum, nextIdx);
}

function isMobileViewport() {
    return window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches;
}

function updateMobileImageViewer() {
    if (!currentAlbum || !mobileViewerImg) return;
    const plate = currentAlbum.plates[currentIndex];
    mobileViewerImg.src = getImagePath(currentAlbum.imageFolder, getMasterFile(plate));
    mobileViewerImg.alt = plate["Exhibition Title"] || currentAlbum.title;
    if (mobileViewerNative) mobileViewerNative.textContent = plate["Native Name"] || currentAlbum.nativeName;
    if (mobileViewerTitle) mobileViewerTitle.textContent = `${plate["Exhibition Title"] || currentAlbum.title} // ${formatRef(currentIndex)}`;
}

function openMobileImageViewer(index = currentIndex) {
    if (!isMobileViewport() || !currentAlbum || !mobileImageViewer) return;
    currentIndex = index;
    updateMobileImageViewer();
    mobileImageViewer.classList.add('is-open');
    mobileImageViewer.classList.remove('is-borderless');
    mobileImageViewer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mobile-viewer-active');
}

function closeMobileImageViewer() {
    if (!mobileImageViewer) return;
    mobileImageViewer.classList.remove('is-open');
    mobileImageViewer.classList.remove('is-borderless');
    mobileImageViewer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mobile-viewer-active');
}

function toggleMobileViewerChrome() {
    if (!mobileImageViewer?.classList.contains('is-open')) return;
    mobileImageViewer.classList.toggle('is-borderless');
}

function navigateMobileImageViewer(direction) {
    if (!currentAlbum) return;
    let nextIdx = currentIndex + direction;
    if (nextIdx < 0) nextIdx = currentAlbum.plates.length - 1;
    else if (nextIdx >= currentAlbum.plates.length) nextIdx = 0;
    currentIndex = nextIdx;
    updateMobileImageViewer();
}

if (mobileImageViewer) {
    mobileImageViewer.addEventListener('touchstart', event => {
        const touch = event.changedTouches[0];
        mobileViewerTouchStartX = touch.clientX;
        mobileViewerTouchStartY = touch.clientY;
    }, { passive: true });

    mobileImageViewer.addEventListener('touchend', event => {
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - mobileViewerTouchStartX;
        const deltaY = touch.clientY - mobileViewerTouchStartY;
        if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
            navigateMobileImageViewer(deltaX < 0 ? 1 : -1);
            return;
        }
        if (event.target === mobileViewerImg && Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) {
            toggleMobileViewerChrome();
        }
    }, { passive: true });

    mobileViewerImg?.addEventListener('click', () => {
        if (!('ontouchstart' in window)) toggleMobileViewerChrome();
    });
}

// Global UI State Interactivity Handlers
function toggleMobileMenu(forceState) {
    const drawer = document.getElementById('mobile-nav-drawer');
    const trigger = document.getElementById('mobile-nav-trigger');
    if (!drawer) return;
    
    const isOpen = drawer.classList.contains('mobile-nav-drawer-active');
    const nextState = (typeof forceState === 'boolean') ? forceState : !isOpen;
    
    if (nextState) {
        drawer.classList.remove('mobile-nav-drawer-hidden');
        drawer.classList.add('mobile-nav-drawer-active');
        if (trigger) trigger.textContent = 'CLOSE';
    } else {
        drawer.classList.remove('mobile-nav-drawer-active');
        drawer.classList.add('mobile-nav-drawer-hidden');
        if (trigger) trigger.textContent = 'MENU';
    }
}

function toggleMobileAccordion(element) {
    const parentSection = element.parentElement;
    if (!parentSection) return;
    const isExpanded = parentSection.classList.contains('accordion-active');
    
    document.querySelectorAll('.mobile-menu-section').forEach(sec => {
        sec.classList.remove('accordion-active');
    });
    if (!isExpanded) parentSection.classList.add('accordion-active');
}

function toggleAboutModal(show) {
    const overlay = document.getElementById('about-overlay');
    if (!overlay) return;
    overlay.classList.toggle('visible', Boolean(show));
}

Object.assign(window, {
    enterLocation,
    filterGallery,
    closeMobileImageViewer,
    handleBack,
    navigateDetail,
    navigateMobileImageViewer,
    toggleMobileViewerChrome,
    openDetailView,
    openMobileImageViewer,
    openPlateView,
    showHome,
    toggleAboutModal,
    toggleMobileAccordion,
    toggleMobileMenu
});
