import MapKit
import SwiftUI

struct ScooterControlDock: View {
    @Bindable var model: ScooterMapModel
    @Binding var isExpanded: Bool
    @State private var dragTranslation: CGFloat = 0
    @State private var collapsedContentHeight: CGFloat = 0
    @State private var fullContentHeight: CGFloat = 0

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                dragHandle
                summaryHeader
                providerPicker
            }
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.height
            } action: { height in
                collapsedContentHeight = height
            }

            VStack(spacing: 18) {
                if let scooter = model.selectedScooter {
                    selectedScooterActions(scooter)
                }

                batteryFilter
                mapStylePicker
                attribution
            }
            .padding(.horizontal, 16)
            .padding(.top, 7)
            .padding(.bottom, 18)
            .opacity(expandedContentOpacity)
            .allowsHitTesting(isExpanded && dragTranslation == 0)
            .accessibilityHidden(!isExpanded)
        }
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { height in
            fullContentHeight = height
        }
        .frame(height: visibleDrawerHeight, alignment: .top)
        .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .padding(.bottom, 2)
        .glassEffect(
            .regular,
            in: RoundedRectangle(cornerRadius: 30, style: .continuous)
        )
        .shadow(color: .black.opacity(0.14), radius: 18, y: 8)
        .opacity(drawerTravel == 0 ? 0 : 1)
        .frame(maxHeight: .infinity, alignment: .bottom)
        .animation(.snappy(duration: 0.3), value: model.selectedScooterID)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scooter controls")
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
        .gesture(handleGesture)
        .animation(.easeOut(duration: 0.12), value: isDragging)
        .accessibilityLabel(isExpanded ? "Collapse controls" : "Expand controls")
        .accessibilityHint("Tap or drag vertically")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { toggleExpanded() }
    }

    private var handleGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                dragTranslation = value.translation.height
            }
            .onEnded { value in
                let verticalDistance = value.translation.height
                let horizontalDistance = value.translation.width

                if abs(verticalDistance) < 8, abs(horizontalDistance) < 8 {
                    finishDrag(expanded: !isExpanded)
                } else {
                    let restingHeight = isExpanded ? fullContentHeight : collapsedContentHeight
                    let projectedHeight = min(
                        fullContentHeight,
                        max(
                            collapsedContentHeight,
                            restingHeight - value.predictedEndTranslation.height
                        )
                    )
                    finishDrag(
                        expanded: projectedHeight > collapsedContentHeight + drawerTravel * 0.5
                    )
                }
            }
    }

    private var isDragging: Bool {
        abs(dragTranslation) > 0.5
    }

    private var drawerTravel: CGFloat {
        max(0, fullContentHeight - collapsedContentHeight)
    }

    private var visibleDrawerHeight: CGFloat {
        guard drawerTravel > 0 else { return fullContentHeight }
        let restingHeight = isExpanded ? fullContentHeight : collapsedContentHeight
        return min(
            fullContentHeight,
            max(collapsedContentHeight, restingHeight - dragTranslation)
        )
    }

    private var expansionProgress: CGFloat {
        guard drawerTravel > 0 else { return 0 }
        return (visibleDrawerHeight - collapsedContentHeight) / drawerTravel
    }

    private var expandedContentOpacity: Double {
        Double(min(1, max(0, (expansionProgress - 0.08) / 0.72)))
    }

    private var summaryHeader: some View {
        Button(action: toggleExpanded) {
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
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .accessibilityLabel(isExpanded ? "Collapse scooter controls" : "Expand scooter controls")
    }

    private var countSummary: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(model.visibleCount, format: .number)
                    .font(.system(size: 27, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                Text(model.visibleCount == 1 ? "scooter" : "scooters")
                    .font(.headline)
            }

            HStack(spacing: 6) {
                if model.isLoading {
                    ProgressView()
                        .controlSize(.mini)
                }
                Text(updateLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
        .frame(height: 42)
        .padding(.bottom, 11)
    }

    private func providerButton(_ provider: ScooterProvider) -> some View {
        let isSelected = model.selectedProvider == provider
        let isDimmed = model.selectedProvider != nil && !isSelected

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
            .frame(minHeight: 34)
        }
        .buttonStyle(.plain)
        .glassEffect(
            .regular
                .tint(isSelected ? provider.color.opacity(0.28) : nil)
                .interactive(),
            in: Capsule()
        )
        .opacity(isDimmed ? 0.48 : 1)
        .accessibilityLabel(
            "\(provider.name), \(model.count(for: provider)) scooters, \(isSelected ? "selected" : "not selected")"
        )
    }

    private func selectedScooterActions(_ scooter: Scooter) -> some View {
        VStack(spacing: 13) {
            HStack(spacing: 14) {
                if let battery = scooter.battery {
                    metric(
                        title: "Battery",
                        value: "\(battery)%",
                        systemImage: batterySymbol(for: battery),
                        color: batteryColor(for: battery)
                    )
                }
                if let range = scooter.formattedRange {
                    metric(
                        title: "Estimated",
                        value: range.replacingOccurrences(of: " range", with: ""),
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
            HStack {
                Label("Minimum battery", systemImage: "battery.50percent")
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(model.minimumBattery == 0 ? "Any" : "\(Int(model.minimumBattery))%")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }

            Slider(value: $model.minimumBattery, in: 0 ... 100, step: 5)
                .tint(.blue)
                .accessibilityLabel("Minimum battery")
                .accessibilityValue(model.minimumBattery == 0 ? "Any" : "\(Int(model.minimumBattery)) percent")
                .sensoryFeedback(.selection, trigger: Int(model.minimumBattery / 5))
        }
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
        Text("Mobility data: SFOE Shared Mobility and Hopp")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, alignment: .center)
    }

    private var updateLabel: String {
        if model.isLoading { return "Updating nearby vehicles…" }
        guard let lastUpdated = model.lastUpdated else { return "On this map" }
        return "Updated \(lastUpdated.formatted(date: .omitted, time: .shortened))"
    }

    private func toggleExpanded() {
        setExpanded(!isExpanded)
    }

    private func setExpanded(_ expanded: Bool) {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.86, blendDuration: 0.12)) {
            isExpanded = expanded
        }
    }

    private func finishDrag(expanded: Bool) {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.86, blendDuration: 0.12)) {
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

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 12) {
                Button {
                    model.focusOnUser()
                } label: {
                    Image(systemName: "location.fill")
                        .frame(width: 48, height: 48)
                }
                .accessibilityLabel("Go to my location")

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
                .accessibilityLabel("Refresh scooters")
            }
            .buttonStyle(.glass)
            .font(.system(size: 18, weight: .semibold))
        }
    }
}

struct MapStatusBanner: View {
    let message: String
    let isError: Bool
    let retry: (() -> Void)?

    var body: some View {
        HStack(spacing: 9) {
            if isError {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            } else {
                ProgressView()
                    .controlSize(.small)
            }

            Text(message)
                .font(.caption.weight(.semibold))
                .lineLimit(2)

            if let retry {
                Button("Retry", action: retry)
                    .font(.caption.weight(.bold))
                    .buttonStyle(.glassProminent)
                    .tint(.red)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, retry == nil ? 14 : 5)
        .padding(.vertical, retry == nil ? 10 : 5)
        .glassEffect(.regular, in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 12, y: 5)
        .accessibilityElement(children: .combine)
    }
}
