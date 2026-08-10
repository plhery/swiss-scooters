import MapKit
import SwiftUI

struct ScooterControlDock: View {
    @Bindable var model: ScooterMapModel
    @Binding var isExpanded: Bool
    @State private var dragTranslation: CGFloat = 0
    @State private var collapsedContentHeight: CGFloat = 0
    @State private var fullContentHeight: CGFloat = 0
    @State private var batteryDraft: Double
    @State private var settingsExpanded = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let onCollapsedHeightChange: (CGFloat) -> Void
    private let surfaceBottomPadding: CGFloat = 2
    private let shadowOverflow: CGFloat = 24

    init(
        model: ScooterMapModel,
        isExpanded: Binding<Bool>,
        onCollapsedHeightChange: @escaping (CGFloat) -> Void = { _ in }
    ) {
        self.model = model
        _isExpanded = isExpanded
        _batteryDraft = State(initialValue: model.minimumBattery)
        self.onCollapsedHeightChange = onCollapsedHeightChange
    }

    var body: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    draggableHeader
                    if let scooter = model.selectedScooter {
                        selectedScooterActions(scooter)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                    } else {
                        providerPicker
                    }
                }
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.height
                } action: { height in
                    guard abs(collapsedContentHeight - height) > 0.5 else { return }
                    collapsedContentHeight = height
                    onCollapsedHeightChange(height + surfaceBottomPadding)
                }

                VStack(spacing: 18) {
                    nearbyScooters
                    batteryFilter
                    settingsDisclosure
                }
                .padding(.horizontal, 16)
                .padding(.top, 7)
                .padding(.bottom, 18)
                .opacity(expandedContentOpacity)
                .allowsHitTesting(isExpanded && !isDragging)
                .accessibilityHidden(!isExpanded)
            }
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.height
            } action: { height in
                fullContentHeight = height
            }
            .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
            .padding(.bottom, surfaceBottomPadding)
            .glassEffect(
                .regular,
                in: RoundedRectangle(cornerRadius: 30, style: .continuous)
            )
            .shadow(color: .black.opacity(0.14), radius: 18, y: 8)
            .offset(y: shadowOverflow + drawerOffset)
        }
        .frame(height: drawerViewportHeight, alignment: .top)
        .clipped()
        .opacity(drawerTravel == 0 ? 0 : 1)
        .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: model.selectedScooterID)
    }

    private var draggableHeader: some View {
        VStack(spacing: 0) {
            dragHandle
            summaryHeader
        }
        .contentShape(Rectangle())
        .gesture(headerGesture)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            isExpanded
                ? String(localized: "Collapse scooter controls")
                : String(localized: "Expand scooter controls")
        )
        .accessibilityHint(String(localized: "Tap or drag vertically"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { toggleExpanded() }
    }

    private var dragHandle: some View {
        ZStack {
            Color.clear

            Capsule()
                .fill(.secondary.opacity(isDragging ? 0.5 : 0.32))
                .frame(width: 36, height: 5)
                .scaleEffect(x: isDragging ? 1.22 : 1, y: 1)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 30)
        .contentShape(Rectangle())
        .animation(.easeOut(duration: 0.12), value: isDragging)
    }

    private var headerGesture: some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .global)
            .onChanged { value in
                dragTranslation = value.translation.height
            }
            .onEnded { value in
                let restingOffset = isExpanded ? 0 : drawerTravel
                let projectedOffset = min(
                    drawerTravel,
                    max(0, restingOffset + value.predictedEndTranslation.height)
                )
                finishDrag(
                    expanded: projectedOffset < drawerTravel * 0.5
                )
            }
            .exclusively(before: TapGesture().onEnded { toggleExpanded() })
    }

    private var isDragging: Bool {
        abs(dragTranslation) > 0.5
    }

    private var drawerTravel: CGFloat {
        guard fullContentHeight > 0, collapsedContentHeight > 0 else { return 0 }
        return max(0, fullContentHeight - collapsedContentHeight)
    }

    private var drawerOffset: CGFloat {
        guard drawerTravel > 0 else { return 0 }
        let restingOffset = isExpanded ? 0 : drawerTravel
        return min(
            drawerTravel,
            max(0, restingOffset + dragTranslation)
        )
    }

    private var drawerViewportHeight: CGFloat {
        guard fullContentHeight > 0 else { return 0 }
        return fullContentHeight + surfaceBottomPadding + shadowOverflow
    }

    private var expansionProgress: CGFloat {
        guard drawerTravel > 0 else { return 0 }
        return 1 - drawerOffset / drawerTravel
    }

    private var expandedContentOpacity: Double {
        Double(min(1, max(0, (expansionProgress - 0.08) / 0.72)))
    }

    private var summaryHeader: some View {
        HStack(spacing: 12) {
            if let scooter = model.selectedScooter {
                selectedSummary(scooter)
            } else {
                countSummary
            }

            Spacer(minLength: 8)

            Image(systemName: "chevron.up")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.secondary)
                .frame(width: 36, height: 36)
                .rotationEffect(.degrees(180 * expansionProgress))
                .glassEffect(.clear.interactive(), in: Circle())
        }
        .contentShape(Rectangle())
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private var countSummary: some View {
        VStack(alignment: .leading, spacing: 2) {
            if model.isLoading && model.lastUpdated == nil {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Finding scooters…")
                        .font(.headline)
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(model.visibleCount, format: .number)
                        .font(.system(size: 27, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                    Text(
                        model.visibleCount == 1
                            ? String(localized: "scooter")
                            : String(localized: "scooters")
                    )
                        .font(.headline)
                }
            }

            HStack(spacing: 6) {
                if model.isLoading {
                    ProgressView()
                        .controlSize(.mini)
                }
                Text(model.hasActiveFilters ? String(localized: "Filters active") + " · " + updateLabel : updateLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let dataHealthMessage = model.dataHealthMessage {
                Label(dataHealthMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(String(
                        format: String(localized: "Data status: %@"),
                        dataHealthMessage
                    ))
            }
        }
    }

    private func selectedSummary(_ scooter: Scooter) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(scooter.providerInfo?.color ?? .secondary)
                .frame(width: 12, height: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(scooter.providerInfo?.name ?? scooter.provider.capitalized)
                    .font(.headline)
                HStack(spacing: 7) {
                    if let distance = model.formattedDistance(for: scooter) {
                        Text(distance)
                            .accessibilityLabel(String(
                                format: String(localized: "Straight-line distance, %@"),
                                distance
                            ))
                    }
                    if let battery = scooter.battery {
                        Label("\(battery)%", systemImage: batterySymbol(for: battery))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var providerPicker: some View {
        GlassEffectContainer(spacing: 8) {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    allProvidersButton
                    ForEach(ScooterProvider.allCases) { provider in
                        providerButton(provider)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled(false)
            .clipped()
        }
        .padding(.bottom, 11)
    }

    private var allProvidersButton: some View {
        let isSelected = model.allProvidersSelected

        return Button {
            model.showAllProviders()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "circle.grid.2x2.fill")
                    .foregroundStyle(.blue)
                Text("All")
                    .fontWeight(.semibold)
                Text(model.allProviderCount, format: .number)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .font(.caption)
            .padding(.horizontal, 11)
            .frame(minHeight: 40)
        }
        .buttonStyle(.plain)
        .glassEffect(
            .regular
                .tint(isSelected ? Color.blue.opacity(0.22) : nil)
                .interactive(),
            in: Capsule()
        )
        .opacity(isSelected ? 1 : 0.48)
        .accessibilityLabel(
            String(
                format: String(localized: "All providers, %@ scooters, %@"),
                model.allProviderCount.formatted(),
                isSelected ? String(localized: "selected") : String(localized: "not selected")
            )
        )
    }

    private func providerButton(_ provider: ScooterProvider) -> some View {
        let isSelected = model.enabledProviders.contains(provider)
        let isDimmed = !isSelected

        return Button {
            model.toggle(provider: provider)
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(provider.color)
                    .frame(width: 9, height: 9)
                Text(provider.name)
                    .fontWeight(.semibold)
                Text(model.count(for: provider), format: .number)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .font(.caption)
            .padding(.horizontal, 11)
            .frame(minHeight: 40)
        }
        .buttonStyle(.plain)
        .glassEffect(
            .regular
                .tint(isSelected && !model.allProvidersSelected ? provider.color.opacity(0.28) : nil)
                .interactive(),
            in: Capsule()
        )
        .opacity(isDimmed ? 0.48 : 1)
        .accessibilityLabel(
            String(
                format: String(localized: "%@, %@ scooters, %@"),
                provider.name,
                model.count(for: provider).formatted(),
                isSelected ? String(localized: "selected") : String(localized: "not selected")
            )
        )
    }

    private func selectedScooterActions(_ scooter: Scooter) -> some View {
        VStack(spacing: 13) {
            HStack {
                Text(scooter.providerInfo?.name ?? scooter.provider.capitalized)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button {
                    model.selectScooter(nil)
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .accessibilityLabel(String(localized: "Close scooter details"))
            }

            HStack(spacing: 14) {
                if let battery = scooter.battery {
                    metric(
                        title: String(localized: "Battery"),
                        value: "\(battery)%",
                        systemImage: batterySymbol(for: battery),
                        color: batteryColor(for: battery)
                    )
                }
                if let range = scooter.formattedRange {
                    metric(
                        title: String(localized: "Estimated"),
                        value: range,
                        systemImage: "gauge.with.dots.needle.67percent",
                        color: .blue
                    )
                }
            }

            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    Button {
                        openWalkingDirections(to: scooter)
                    } label: {
                        Label("Walk there", systemImage: "figure.walk")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)

                    if let deepLink = scooter.deepLink, let url = URL(string: deepLink) {
                        Link(destination: url) {
                            Label("Rent", systemImage: "scooter")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                        .tint(scooter.providerInfo?.color ?? .blue)
                    }
                }
                .fontWeight(.semibold)
                .controlSize(.large)
            }
        }
        .padding(14)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var nearbyScooters: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Nearby scooters", systemImage: "figure.walk")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if model.hasActiveFilters {
                    Button("Reset filters", action: model.resetFilters)
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.plain)
                        .foregroundStyle(.blue)
                }
            }

            if model.visibleCount == 0 && !model.isLoading {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        model.hasActiveFilters
                            ? String(localized: "No scooters match your filters")
                            : String(localized: "No scooters in this area")
                    )
                        .font(.subheadline.weight(.semibold))
                    Text("Move the map, zoom out, or search another place.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        if model.hasActiveFilters {
                            Button("Reset filters", action: model.resetFilters)
                                .buttonStyle(.glassProminent)
                        }
                        Button("Show Switzerland", action: model.focusOnSwitzerland)
                            .buttonStyle(.glass)
                    }
                    .font(.caption.weight(.semibold))
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 7) {
                    ForEach(model.nearbyScooters) { scooter in
                        Button {
                            model.focusOnScooter(scooter)
                        } label: {
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(scooter.providerInfo?.color ?? .secondary)
                                    .frame(width: 11, height: 11)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(scooter.providerInfo?.name ?? scooter.provider.capitalized)
                                        .font(.subheadline.weight(.semibold))
                                    HStack(spacing: 6) {
                                        if let distance = model.formattedDistance(for: scooter) {
                                            Text(distance)
                                        }
                                        if let battery = scooter.battery {
                                            Label("\(battery)%", systemImage: batterySymbol(for: battery))
                                        }
                                        if let range = scooter.formattedRange {
                                            Text(range)
                                        }
                                    }
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(.tertiary)
                            }
                            .contentShape(Rectangle())
                            .padding(.horizontal, 12)
                            .frame(minHeight: 52)
                            .background(
                                .quaternary.opacity(0.42),
                                in: RoundedRectangle(cornerRadius: 15, style: .continuous)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var settingsDisclosure: some View {
        DisclosureGroup(isExpanded: $settingsExpanded) {
            VStack(spacing: 18) {
                mapStylePicker
                attribution
            }
            .padding(.top, 14)
        } label: {
            Label("Settings and map", systemImage: "slider.horizontal.3")
                .font(.subheadline.weight(.semibold))
        }
        .tint(.secondary)
    }

    private func metric(
        title: String,
        value: String,
        systemImage: String,
        color: Color
    ) -> some View {
        HStack(spacing: 9) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(color)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
    }

    private var batteryFilter: some View {
        VStack(spacing: 9) {
            if dynamicTypeSize.isAccessibilitySize {
                Label("Minimum battery", systemImage: "battery.50percent")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity, alignment: .leading)
                batteryValue
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                HStack {
                    Label("Minimum battery", systemImage: "battery.50percent")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    batteryValue
                }
            }

            Slider(value: $batteryDraft, in: 0 ... 100, step: 5) { editing in
                if !editing {
                    model.setMinimumBattery(batteryDraft)
                }
            }
                .tint(.blue)
                .accessibilityLabel("Minimum battery")
                .accessibilityValue(
                    batteryDraft == 0
                        ? String(localized: "Any")
                        : String(
                            format: String(localized: "%lld percent"),
                            Int(batteryDraft)
                        )
                )
                .sensoryFeedback(.selection, trigger: Int(batteryDraft / 5))
                .onChange(of: model.minimumBattery) { _, newValue in
                    batteryDraft = newValue
                }
                .onDisappear {
                    model.setMinimumBattery(batteryDraft)
                }

            if batteryDraft > 0 {
                Text("Scooters without battery data are hidden.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var batteryValue: some View {
        Text(batteryDraft == 0 ? String(localized: "Any") : "\(Int(batteryDraft))%")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .contentTransition(.numericText())
    }

    private var mapStylePicker: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("Apple Maps style", systemImage: "map")
                .font(.subheadline.weight(.medium))

            Picker("Apple Maps style", selection: $model.mapStyle) {
                ForEach(AppleMapStyle.allCases) { style in
                    Text(style.label).tag(style)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private var attribution: some View {
        VStack(spacing: 3) {
            Link(
                "Mobility data: opentransportdata.swiss and Hopp",
                destination: URL(string: "https://opentransportdata.swiss/en/cookbook/shared-mobility/")!
            )
            Link(
                "Address data © swisstopo",
                destination: URL(string: "https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api")!
            )
            Link(
                "Privacy",
                destination: URL(string: "https://swiss-scooters.plhery.com/privacy")!
            )
        }
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, alignment: .center)
    }

    private var updateLabel: String {
        if model.isLoading { return String(localized: "Updating nearby vehicles…") }
        guard let lastUpdated = model.lastUpdated else { return String(localized: "On this map") }
        return String(
            format: String(localized: "Updated %@"),
            lastUpdated.formatted(date: .omitted, time: .shortened)
        )
    }

    private func toggleExpanded() {
        setExpanded(!isExpanded)
    }

    private func setExpanded(_ expanded: Bool) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86, blendDuration: 0.12)) {
            isExpanded = expanded
        }
    }

    private func finishDrag(expanded: Bool) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86, blendDuration: 0.12)) {
            dragTranslation = 0
            isExpanded = expanded
        }
    }

    private func batteryColor(for battery: Int) -> Color {
        if battery >= 50 { return .green }
        if battery >= 20 { return .orange }
        return .red
    }

    private func batterySymbol(for battery: Int) -> String {
        switch battery {
        case 75 ... 100: "battery.100percent"
        case 50 ..< 75: "battery.75percent"
        case 25 ..< 50: "battery.50percent"
        case 10 ..< 25: "battery.25percent"
        default: "battery.0percent"
        }
    }

    private func openWalkingDirections(to scooter: Scooter) {
        let location = CLLocation(latitude: scooter.latitude, longitude: scooter.longitude)
        let destination = MKMapItem(location: location, address: nil)
        destination.name = "\(scooter.providerInfo?.name ?? "Scooter") scooter"
        destination.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
        ])
    }
}

struct FloatingMapControls: View {
    @Bindable var model: ScooterMapModel
    let onLocationIntent: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 12) {
                Button {
                    onLocationIntent()
                    model.focusOnUser()
                } label: {
                    Image(systemName: "location.fill")
                        .frame(width: 48, height: 48)
                }
                .accessibilityLabel(String(localized: "Go to my location"))

                Button {
                    model.refresh()
                } label: {
                    ZStack {
                        Image(systemName: "arrow.clockwise")
                            .opacity(model.isLoading ? 0 : 1)
                        if model.isLoading {
                            ProgressView()
                        }
                    }
                    .frame(width: 48, height: 48)
                }
                .disabled(model.isLoading)
                .accessibilityLabel(String(localized: "Refresh scooters"))
            }
            .buttonStyle(.glass)
            .font(.system(size: 18, weight: .semibold))
        }
    }
}

enum MapStatusBannerStyle: Equatable {
    case progress
    case error
    case location
}

struct MapStatusBanner: View {
    let message: String
    let style: MapStatusBannerStyle
    let actionTitle: String?
    let action: (() -> Void)?

    var body: some View {
        HStack(spacing: 9) {
            switch style {
            case .progress:
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
            case .error:
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .accessibilityHidden(true)
            case .location:
                Image(systemName: "location.slash.fill")
                    .foregroundStyle(.orange)
                    .accessibilityHidden(true)
            }

            Text(message)
                .font(.caption.weight(.semibold))
                .lineLimit(3)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.caption.weight(.bold))
                    .buttonStyle(.glassProminent)
                    .tint(style == .error ? .red : .blue)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, action == nil ? 14 : 5)
        .padding(.vertical, action == nil ? 10 : 5)
        .glassEffect(.regular, in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 12, y: 5)
    }
}
