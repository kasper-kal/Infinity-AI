"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";
import {
  Navigation,
  Search,
  Filter,
  MapPin,
  Star,
  Clock,
  Phone,
  Globe,
  Navigation2,
  X,
  ChevronUp,
  ChevronDown,
  Layers,
  Loader2,
  MapPinCheck,
  Heart,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Place {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  cuisine?: string;
  rating?: number;
  wheelchair?: string;
  outdoorSeating?: string;
  takeaway?: string;
  delivery?: string;
}

interface MapsWidgetProps {
  center: { lat: number; lon: number };
  displayName: string;
  radius: number;
  categories: string[];
  query: string;
  useUserLocation?: boolean;
  onClose?: () => void;
  onGetDirections?: (lat: number, lon: number, name: string) => void;
  onSaveToProject?: (place: Place) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  food: "bg-orange-500",
  coffee: "bg-brown-500",
  bar: "bg-purple-500",
  pizza: "bg-red-500",
  burger: "bg-amber-600",
  sushi: "bg-pink-500",
  ramen: "bg-orange-600",
  pho: "bg-yellow-600",
  tacos: "bg-orange-700",
  chinese: "bg-red-600",
  italian: "bg-green-600",
  indian: "bg-orange-800",
  thai: "bg-purple-600",
  attractions: "bg-blue-500",
  park: "bg-green-500",
  shopping: "bg-pink-500",
  hotel: "bg-indigo-500",
  pharmacy: "bg-red-400",
  atm: "bg-green-400",
  bank: "bg-blue-400",
  fuel: "bg-gray-500",
  charging: "bg-teal-500",
  other: "bg-gray-400",
};

const CATEGORY_ICONS: Record<string, string> = {
  food: "🍽️",
  coffee: "☕",
  bar: "🍺",
  pizza: "🍕",
  burger: "🍔",
  sushi: "🍣",
  ramen: "🍜",
  pho: "🍲",
  tacos: "🌮",
  chinese: "🥢",
  italian: "🍝",
  indian: "🍛",
  thai: "🌶️",
  attractions: "🏛️",
  park: "🌳",
  shopping: "🛍️",
  hotel: "🏨",
  pharmacy: "💊",
  atm: "💵",
  bank: "🏦",
  fuel: "⛽",
  charging: "🔌",
  other: "📍",
};

const CATEGORY_LABELS: Record<string, string> = {
  food: "Food",
  coffee: "Coffee",
  bar: "Bars",
  pizza: "Pizza",
  burger: "Burgers",
  sushi: "Sushi",
  ramen: "Ramen",
  pho: "Pho",
  tacos: "Tacos",
  chinese: "Chinese",
  italian: "Italian",
  indian: "Indian",
  thai: "Thai",
  attractions: "Attractions",
  park: "Parks",
  shopping: "Shopping",
  hotel: "Hotels",
  pharmacy: "Pharmacy",
  atm: "ATMs",
  bank: "Banks",
  fuel: "Fuel",
  charging: "EV Charging",
  other: "Other",
};

function CategoryFilter({
  categories,
  selectedCategories,
  onToggle,
}: {
  categories: string[];
  selectedCategories: string[];
  onToggle: (cat: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2 px-1 scrollbar-hide">
      {["all", ...categories].map((cat) => (
        <button
          key={cat}
          onClick={() => { haptics.light(); onToggle(cat); }}
          className={cn(
            "whitespace-nowrap px-3 py-1.5 rounded-full text-[11px] font-medium transition-all",
            selectedCategories.includes(cat) || (cat === "all" && selectedCategories.length === 0)
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted/50 text-muted-foreground hover:bg-muted/70"
          )}
        >
          {cat === "all" ? "All" : CATEGORY_LABELS[cat] ?? cat}
        </button>
      ))}
    </div>
  );
}

function RadiusSlider({
  radius,
  onChange,
}: {
  radius: number;
  onChange: (r: number) => void;
}) {
  const radiusKm = radius / 1000;
  return (
    <div className="flex items-center gap-2">
      <Search className="w-4 h-4 text-muted-foreground/60" />
      <input
        type="range"
        min="100"
        max="10000"
        step="100"
        value={radius}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="flex-1 h-1.5 bg-muted/50 rounded-full appearance-none accent-primary cursor-pointer"
        aria-label="Search radius"
      />
      <span className="text-[11px] font-mono text-muted-foreground/70 w-16 text-right">
        {radiusKm >= 1 ? `${radiusKm.toFixed(1)} km` : `${radius} m`}
      </span>
    </div>
  );
}

function PlaceMarker({ place, isSelected, onClick }: { place: Place; isSelected: boolean; onClick: () => void }) {
  const color = CATEGORY_COLORS[place.category]?.replace("bg-", "") ?? "gray-400";
  const icon = CATEGORY_ICONS[place.category] ?? "📍";

  return (
    <Marker position={[place.lat, place.lon]}>
      <div
        onClick={onClick}
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all cursor-pointer",
          isSelected
            ? "border-primary bg-background shadow-lg scale-110"
            : `border-${color} bg-${color}/20 hover:scale-110`
        )}
      >
        <span className="text-[11px]">{icon}</span>
      </div>
    </Marker>
  );
}

function BottomSheet({
  place,
  isOpen,
  onClose,
  onGetDirections,
  onSaveToProject,
  sheetHeight,
  setSheetHeight,
}: {
  place: Place | null;
  isOpen: boolean;
  onClose: () => void;
  onGetDirections: () => void;
  onSaveToProject: () => void;
  sheetHeight: number;
  setSheetHeight: (h: number) => void;
}) {
  if (!place || !isOpen) return null;

  const handleDrag = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const startY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const startHeight = sheetHeight;

    const moveHandler = (moveEvent: TouchEvent | MouseEvent) => {
      const currentY = "touches" in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
      const delta = startY - currentY;
      const newHeight = Math.max(120, Math.min(window.innerHeight * 0.9, startHeight + delta));
      setSheetHeight(newHeight);
    };

    const upHandler = () => {
      window.removeEventListener("mousemove", moveHandler);
      window.removeEventListener("mouseup", upHandler);
      window.removeEventListener("touchmove", moveHandler);
      window.removeEventListener("touchend", upHandler);
    };

    window.addEventListener("mousemove", moveHandler);
    window.addEventListener("mouseup", upHandler);
    window.addEventListener("touchmove", moveHandler, { passive: true });
    window.addEventListener("touchend", upHandler);
  }, [sheetHeight, setSheetHeight]);

  const getDirectionsUrl = (lat: number, lon: number, name: string) => {
    // Try to detect platform and use appropriate maps app
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    if (isIOS) {
      // Apple Maps universal link
      return `maps://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`;
    } else if (isAndroid) {
      // Google Maps intent
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    } else {
      // Fallback to Google Maps web
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    }
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
      style={{ height: sheetHeight }}
    >
      <div
        className="pointer-events-auto absolute bottom-0 left-0 right-0 rounded-t-2xl bg-background border-t border-border shadow-2xl"
        style={{ height: "100%", maxHeight: "90vh" }}
        onTouchStart={handleDrag}
        onMouseDown={handleDrag}
      >
        {/* Drag handle */}
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-muted/50 rounded-full" />
        </div>

        <div className="px-4 pb-4 overflow-y-auto" style={{ maxHeight: `calc(100% - 60px)` }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{CATEGORY_ICONS[place.category] ?? "📍"}</span>
                <h3 className="text-lg font-semibold text-foreground truncate">{place.name}</h3>
                <span
                  className={cn(
                    "ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium",
                    CATEGORY_COLORS[place.category] ?? "bg-gray-400 text-white"
                  )}
                >
                  {CATEGORY_LABELS[place.category] ?? place.category}
                </span>
              </div>
              {place.address && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {place.address}
                </p>
              )}
            </div>
            <button
              onClick={() => { haptics.light(); onClose(); }}
              className="p-2 rounded-lg bg-muted/50 text-muted-foreground hover:bg-muted/70 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Details */}
          <div className="space-y-3">
            {place.rating && (
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                <span className="font-medium">{place.rating.toFixed(1)}</span>
                <span className="text-muted-foreground">({place.rating >= 4.5 ? "Excellent" : place.rating >= 4 ? "Great" : place.rating >= 3.5 ? "Good" : "Average"})</span>
              </div>
            )}

            {place.openingHours && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>{place.openingHours}</span>
              </div>
            )}

            {place.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <a href={`tel:${place.phone}`} className="text-primary hover:underline">{place.phone}</a>
              </div>
            )}

            {place.website && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <a href={place.website} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline truncate">
                  {place.website.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}

            {place.cuisine && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="px-2 py-0.5 rounded bg-muted/50 text-[10px] font-medium">{place.cuisine}</span>
              </div>
            )}

            {place.wheelchair && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="text-lg">♿</span>
                <span>Wheelchair accessible: {place.wheelchair === "yes" ? "Yes" : place.wheelchair === "limited" ? "Limited" : place.wheelchair}</span>
              </div>
            )}

            {place.outdoorSeating && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="text-lg">🪑</span>
                <span>Outdoor seating: {place.outdoorSeating === "yes" ? "Yes" : place.outdoorSeating}</span>
              </div>
            )}

            {place.takeaway && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="text-lg">📦</span>
                <span>Takeaway: {place.takeaway === "yes" ? "Yes" : place.takeaway}</span>
              </div>
            )}

            {place.delivery && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="text-lg">🚚</span>
                <span>Delivery: {place.delivery === "yes" ? "Yes" : place.delivery}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                haptics.medium();
                const url = getDirectionsUrl(place.lat, place.lon, place.name);
                window.open(url, "_blank");
                onGetDirections();
              }}
              className="col-span-2 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors active:scale-[0.98]"
            >
              <Navigation2 className="w-4.5 h-4.5" />
              Get Directions
            </button>
            <button
              onClick={() => { haptics.light(); onSaveToProject(); }}
              className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl border border-border bg-background text-foreground font-medium hover:bg-muted transition-colors active:scale-[0.98]"
            >
              <Heart className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* More actions */}
          <div className="mt-3 border-t border-border/50 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">More actions</span>
              <button className="p-2 rounded-lg hover:bg-muted transition-colors">
                <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm hover:bg-muted transition-colors">
                <Share2 className="w-4 h-4" />
                Share
              </button>
              <button className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm hover:bg-muted transition-colors">
                <MapPinCheck className="w-4 h-4" />
                Save location
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapComponent({
  center,
  places,
  selectedPlace,
  onPlaceClick,
  radius,
  categories,
}: {
  center: { lat: number; lon: number };
  places: Place[];
  selectedPlace: Place | null;
  onPlaceClick: (place: Place) => void;
  radius: number;
  categories: string[];
}) {
  const mapRef = useRef<L.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMapLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useMapEvents({
    load() {
      setMapLoaded(true);
    },
    moveend() {
      // Could trigger search for new area
    },
  });

  if (!mapLoaded) {
    return (
      <div className="w-full h-[400px] flex items-center justify-center bg-muted/30 rounded-xl">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <MapContainer
      center={[center.lat, center.lon]}
      zoom={14}
      style={{ width: "100%", height: "100%", minHeight: 400 }}
      className="rounded-xl"
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />

      {/* Search radius circle */}
      <Circle
        center={[center.lat, center.lon]}
        radius={radius}
        color="var(--primary)"
        fillColor="var(--primary)"
        fillOpacity={0.08}
        weight={1}
        dashArray="5, 5"
      />

      {/* User location marker */}
      <Marker position={[center.lat, center.lon]} interactive={false}>
        <div className="flex items-center justify-center">
          <div className="w-3 h-3 bg-primary rounded-full border-2 border-background shadow-lg" />
          <div className="absolute w-7 h-7 bg-primary/20 rounded-full animate-ping" />
        </div>
      </Marker>

      {/* Places with clustering */}
      <MarkerClusterGroup
        options={{
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          singleMarkerMode: false,
          iconCreateFunction: (cluster: any) => {
            const count = cluster.getChildCount();
            let size = "small";
            if (count >= 100) size = "large";
            else if (count >= 10) size = "medium";

            const iconSizeValue = size === "large" ? 50 : size === "medium" ? 40 : 30;
            return L.divIcon({
              html: `<div class="cluster-marker cluster-${size}">${count}</div>`,
              className: "leaflet-cluster-custom",
              iconSize: [iconSizeValue, iconSizeValue],
            });
          },
        }}
      >
        {places.map((place) => (
          <PlaceMarker
            key={place.id}
            place={place}
            isSelected={selectedPlace?.id === place.id}
            onClick={() => onPlaceClick(place)}
          />
        ))}
      </MarkerClusterGroup>

      {/* Zoom controls */}
      <div className="leaflet-bottom leaflet-right leaflet-control-container" style={{ pointerEvents: "none" }}>
        <div className="leaflet-control leaflet-bar" style={{ pointerEvents: "auto" }}>
          <a
            className="leaflet-control-zoom-in"
            href="#"
            title="Zoom in"
            onClick={(e) => { e.preventDefault(); mapRef.current?.zoomIn(); }}
            style={{ display: "block" }}
          >+</a>
          <a
            className="leaflet-control-zoom-out"
            href="#"
            title="Zoom out"
            onClick={(e) => { e.preventDefault(); mapRef.current?.zoomOut(); }}
            style={{ display: "block" }}
          >−</a>
        </div>
      </div>
    </MapContainer>
  );
}

export function MapsWidget({
  center,
  displayName,
  radius: initialRadius,
  categories: initialCategories,
  query,
  useUserLocation,
  onClose,
  onGetDirections,
  onSaveToProject,
}: MapsWidgetProps) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(280);
  const [radius, setRadius] = useState(initialRadius);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState(center);

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        lat: mapCenter.lat.toString(),
        lon: mapCenter.lon.toString(),
        radius: radius.toString(),
        categories: selectedCategories.length > 0 ? selectedCategories.join(",") : initialCategories.join(","),
      });

      const res = await fetch(`/api/jarvis/maps/search?${params}`);
      if (!res.ok) throw new Error("Failed to fetch places");
      const data = await res.json();
      setPlaces(data.places ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load places");
      setPlaces([]);
    } finally {
      setLoading(false);
    }
  }, [mapCenter, radius, selectedCategories, initialCategories]);

  useEffect(() => {
    fetchPlaces();
  }, [fetchPlaces]);

  useEffect(() => {
    if (selectedPlace) {
      setSheetOpen(true);
      setSheetHeight(320);
    } else {
      setSheetOpen(false);
    }
  }, [selectedPlace]);

  const handlePlaceClick = (place: Place) => {
    haptics.light();
    setSelectedPlace(place);
  };

  const handleCloseSheet = () => {
    haptics.light();
    setSelectedPlace(null);
    setSheetOpen(false);
  };

  const handleGetDirections = () => {
    if (selectedPlace && onGetDirections) {
      onGetDirections(selectedPlace.lat, selectedPlace.lon, selectedPlace.name);
    }
  };

  const handleSaveToProject = () => {
    if (selectedPlace && onSaveToProject) {
      haptics.medium();
      onSaveToProject(selectedPlace);
    }
  };

  const handleCategoryToggle = (cat: string) => {
    haptics.light();
    if (cat === "all") {
      setSelectedCategories([]);
    } else {
      setSelectedCategories((prev) =>
        prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
      );
    }
  };

  const handleRadiusChange = (newRadius: number) => {
    setRadius(newRadius);
  };

  const handleMapMove = (newCenter: { lat: number; lon: number }) => {
    setMapCenter(newCenter);
    setSelectedPlace(null);
  };

  return (
    <div className="relative w-full rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm overflow-hidden shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Navigation className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-[11px] font-mono tracking-widest text-muted-foreground/50 uppercase">Maps</p>
            <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{displayName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onClose && (
            <button
              onClick={() => { haptics.light(); onClose?.(); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Close map"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="px-3 py-2 space-y-2 border-b border-border/30">
        <CategoryFilter
          categories={initialCategories}
          selectedCategories={selectedCategories}
          onToggle={handleCategoryToggle}
        />
        <RadiusSlider radius={radius} onChange={handleRadiusChange} />
      </div>

      {/* Map */}
      <div className="relative h-[400px] sm:h-[500px]">
        <MapComponent
          center={mapCenter}
          places={places}
          selectedPlace={selectedPlace}
          onPlaceClick={handlePlaceClick}
          radius={radius}
          categories={selectedCategories.length > 0 ? selectedCategories : initialCategories}
        />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="absolute bottom-4 left-4 right-4 mx-auto max-w-md p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            {error}
            <button
              onClick={fetchPlaces}
              className="ml-2 text-xs underline hover:text-destructive"
            >
              Retry
            </button>
          </div>
        )}

        {places.length === 0 && !loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 px-4">
            <div className="text-center">
              <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground">No places found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Try expanding the radius or changing categories</p>
            </div>
          </div>
        )}

        {/* Place count badge */}
        <div className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full bg-background/90 backdrop-blur border border-border/50 text-[10px] font-mono text-muted-foreground">
          {places.length} place{places.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Bottom Sheet */}
      <BottomSheet
        place={selectedPlace}
        isOpen={sheetOpen}
        onClose={handleCloseSheet}
        onGetDirections={handleGetDirections}
        onSaveToProject={handleSaveToProject}
        sheetHeight={sheetHeight}
        setSheetHeight={setSheetHeight}
      />
    </div>
  );
}