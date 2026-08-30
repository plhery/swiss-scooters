import Foundation
import MapKit
import SwiftUI
import UIKit

struct ScooterControlDock: View {
    @Bindable var model: ScooterMapModel
    @Binding var isExpanded: Bool
    @State private var briefingHeight: CGFloat = 132
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let onCollapsedHeightChange: (CGFloat) -> Void
    private let maximumBriefingHeight: CGFloat

    init(
        model: ScooterMapModel,
        isExpanded: Binding<Bool>,
        maximumBriefingHeight: CGFloat = .infinity,
        onCollapsedHeightChange: @escaping (CGFloat) -> Void = { _ in }
    ) {
        self.model = model
        _isExpanded = isExpanded
        self.maximumBriefingHeight = maximumBriefingHeight
        self.onCollapsedHeightChange = onCollapsedHeightChange
    }

    var body: some View {
        VStack(spacing: 10) {
            dockHeader
            quickProviderFilters

            if let selectedScooter = model.selectedScooter {
                ScrollView(.vertical) {
                    NearbyBriefingCard(model: model, scooter: selectedScooter)
                        .padding(.horizontal, 2)
                }
                .scrollDisabled(!briefingNeedsScrolling)
                .scrollIndicators(briefingNeedsScrolling ? .visible : .hidden)
                .frame(height: displayedBriefingHeight)
                .background {
                    NearbyBriefingCard(model: model, scooter: selectedScooter)
                        .padding(.horizontal, 2)
                        .fixedSize(horizontal: false, vertical: true)
                        .hidden()
                        .accessibilityHidden(true)
                        .allowsHitTesting(false)
                        .onGeometryChange(for: CGFloat.self) { proxy in
                            proxy.size.height
                        } action: { measuredHeight in
                            briefingHeight = max(132, ceil(measuredHeight))
                        }
                }
                .animation(
                    reduceMotion ? nil : .snappy(duration: 0.25),
                    value: displayedBriefingHeight
                )
                .transition(
                    reduceMotion
                        ? .opacity
                        : .move(edge: .bottom).combined(with: .opacity)
                )
            } else if shouldOfferAllProviders {
                noPreferredProvidersMessage
                    .transition(.opacity)
            } else {
                Label("Tap a marker for details", systemImage: "hand.tap")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 2)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .frame(maxWidth: 560)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 12, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .simultaneousGesture(
            DragGesture(minimumDistance: 18)
                .onEnded { value in
                    if value.translation.height < -44,
                       abs(value.translation.height) > abs(value.translation.width) {
                        isExpanded = true
                    }
                }
        )
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { height in
            onCollapsedHeightChange(height)
        }
        .onChange(of: model.selectedScooterID) { _, _ in
            briefingHeight = 132
        }
        .onChange(of: dynamicTypeSize) { _, _ in
            briefingHeight = 132
        }
        .animation(
            reduceMotion ? nil : .snappy(duration: 0.28, extraBounce: 0.06),
            value: model.selectedScooterID
        )
        .sensoryFeedback(.selection, trigger: model.enabledProviders)
        .accessibilityAction(named: String(localized: "Show nearby scooters")) {
            isExpanded = true
        }
    }

    private var dockHeader: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(model.visibleCount, format: .number)
                        .font(.headline.weight(.bold))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    Text(countLabel)
                        .font(.subheadline.weight(.semibold))
                }

                FreshnessLabel(
                    isLoading: model.isLoading,
                    lastUpdated: model.lastUpdated,
                    dataHealthMessage: model.dataHealthMessage
                )
            }

            Spacer(minLength: 8)

            if model.selectedScooter != nil {
                Button {
                    model.selectScooter(nil)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .frame(width: 44, height: 44)
                        .background(.quaternary, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "Close scooter details"))
                .transition(.scale.combined(with: .opacity))
            }

            Button {
                isExpanded = true
            } label: {
                Label("View all", systemImage: "chevron.up")
                    .labelStyle(.iconOnly)
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 44, height: 44)
                    .background(.quaternary, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(localized: "Show nearby scooters"))
        }
    }

    private var quickProviderFilters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                QuickProviderFilterChip(
                    title: String(localized: "All"),
                    accessibilityTitle: String(localized: "All providers"),
                    count: model.allProviderCount,
                    colors: [],
                    systemImage: "circle.grid.2x2.fill",
                    isSelected: model.allProvidersSelected,
                    accessibilityIsShown: model.allProvidersSelected,
                    action: model.showAllProviders
                )

                ForEach(model.quickProviderOrder) { provider in
                    providerChip(provider)
                }
            }
            .animation(
                reduceMotion ? nil : .snappy(duration: 0.25),
                value: model.quickProviderOrder
            )
        }
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, 2, for: .scrollContent)
    }

    private func providerChip(_ provider: ScooterProvider) -> some View {
        QuickProviderFilterChip(
            title: provider.name,
            accessibilityTitle: provider.name,
            count: model.count(for: provider),
            colors: [provider.color],
            isSelected: !model.allProvidersSelected && model.enabledProviders.contains(provider),
            accessibilityIsShown: model.enabledProviders.contains(provider)
        ) {
            model.toggleQuickProvider(provider)
        }
        .accessibilityHint(quickProviderHint(provider))
    }

    private func quickProviderHint(_ provider: ScooterProvider) -> String {
        if model.allProvidersSelected {
            return String(localized: "Shows only this provider")
        }
        if model.enabledProviders == [provider] {
            return String(localized: "Shows all providers")
        }
        if model.enabledProviders.contains(provider) {
            return String(localized: "Hides this provider")
        }
        return String(localized: "Adds this provider")
    }

    private var shouldOfferAllProviders: Bool {
        !model.allProvidersSelected &&
            model.visibleCount == 0 &&
            model.allProviderCount > 0 &&
            !model.isLoading
    }

    private var noPreferredProvidersMessage: some View {
        HStack(spacing: 10) {
            Label("No selected providers here", systemImage: "mappin.slash")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            Spacer(minLength: 4)

            Button("Show all", action: model.showAllProviders)
                .font(.caption.weight(.bold))
                .buttonStyle(.glass)
        }
        .padding(.leading, 2)
    }

    private var displayedBriefingHeight: CGFloat {
        min(max(132, briefingHeight), max(132, maximumBriefingHeight))
    }

    private var briefingNeedsScrolling: Bool {
        briefingHeight > max(132, maximumBriefingHeight) + 1
    }

    private var countLabel: LocalizedStringKey {
        if model.isShowingClusterSummary { return "scooters in view" }
        return model.visibleCount == 1 ? "scooter on map" : "scooters on map"
    }
}

private struct QuickProviderFilterChip: View {
    let title: String
    let accessibilityTitle: String
    let count: Int
    let colors: [Color]
    var systemImage: String?
    let isSelected: Bool
    let accessibilityIsShown: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                indicator

                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                Text(count, format: .number)
                    .font(.caption2.weight(.bold))
                    .monospacedDigit()
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(.quaternary, in: Capsule())
                    .contentTransition(.numericText())
            }
            .foregroundStyle(isSelected ? Color.blue : Color.primary)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(
                isSelected ? Color.blue.opacity(0.13) : Color.primary.opacity(0.055),
                in: Capsule()
            )
            .overlay {
                Capsule()
                    .stroke(
                        isSelected ? Color.blue.opacity(0.32) : Color.secondary.opacity(0.16),
                        lineWidth: 1
                    )
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(
            accessibilityIsShown ? String(localized: "Shown") : String(localized: "Hidden")
        )
    }

    @ViewBuilder
    private var indicator: some View {
        if let systemImage {
            Image(systemName: systemImage)
                .font(.caption.weight(.bold))
                .foregroundStyle(isSelected ? Color.blue : Color.secondary)
        } else {
            HStack(spacing: -3) {
                ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                    Circle()
                        .fill(color)
                        .frame(width: 11, height: 11)
                        .overlay {
                            Circle().stroke(.background, lineWidth: 1.5)
                        }
                }
            }
            .accessibilityHidden(true)
        }
    }

    private var accessibilityLabel: String {
        if count == 1 {
            return String(format: String(localized: "%@, one scooter"), accessibilityTitle)
        }
        return String(
            format: String(localized: "%@, %lld scooters"),
            accessibilityTitle,
            Int64(count)
        )
    }
}

private struct NearbyBriefingCard: View {
    @Bindable var model: ScooterMapModel
    let scooter: Scooter
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 10) {
            Button {
                model.focusOnScooter(scooter)
            } label: {
                Group {
                    if dynamicTypeSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: 8) {
                            accessibilityWalkingSummary
                            providerDetails
                        }
                    } else {
                        HStack(spacing: 13) {
                            walkingTime

                            Rectangle()
                                .fill(.separator)
                                .frame(width: 0.5, height: 48)

                            providerDetails
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(String(localized: "Centers this scooter on the map"))

            HStack(spacing: 9) {
                actionButtons
            }
            .font(.subheadline.weight(.semibold))
            .controlSize(.large)
        }
    }

    private var accessibilityWalkingSummary: some View {
        Group {
            if let minutes = model.approximateWalkingMinutes(to: scooter) {
                Text(conciseWalkingSummary(minutes: minutes))
                    .font(.headline.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(2)
            } else if let distance = model.formattedDistance(for: scooter) {
                Text(awaySummary(distance: distance))
                    .font(.headline.weight(.bold))
                    .lineLimit(2)
            } else {
                Text("Distance unavailable")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(walkingAccessibilityLabel)
    }

    private var providerDetails: some View {
        HStack(spacing: 9) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    Circle()
                        .fill(providerColor)
                        .frame(width: 9, height: 9)
                    Text(providerName)
                        .font(.headline)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                }

                HStack(spacing: 9) {
                    if let battery = scooter.battery {
                        Label("\(battery)%", systemImage: batterySymbol(for: battery))
                            .foregroundStyle(batteryColor(for: battery))
                    }
                    if let range = scooter.formattedRange {
                        Label(range, systemImage: "gauge.with.dots.needle.67percent")
                    }
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 4)

            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        Button {
            openWalkingDirections(to: scooter)
        } label: {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    Text("Walk")
                } else {
                    Label("Walk", systemImage: "figure.walk")
                }
            }
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)

        if let rentalURL = scooter.rentalURL {
            Link(destination: rentalURL) {
                Group {
                    if dynamicTypeSize.isAccessibilitySize {
                        Text("Rent")
                    } else {
                        Label("Open \(providerName)", systemImage: "scooter")
                    }
                }
                .frame(maxWidth: .infinity)
                .foregroundStyle(providerActionForeground)
            }
            .buttonStyle(.glassProminent)
            .tint(providerActionTint)
            .accessibilityLabel(
                String(format: String(localized: "Open %@"), providerName)
            )
        }
    }

    private var walkingTime: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let minutes = model.approximateWalkingMinutes(to: scooter) {
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text("≈\(minutes)")
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .monospacedDigit()
                    Text("min")
                        .font(.caption.weight(.semibold))
                }
                Text("walk")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
            } else if let distance = model.formattedDistance(for: scooter) {
                Text(distance)
                    .font(.headline)
                Text("away")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : 66, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(walkingAccessibilityLabel)
    }

    private var walkingAccessibilityLabel: String {
        if let minutes = model.approximateWalkingMinutes(to: scooter) {
            if minutes == 1 {
                return String(localized: "Approximately one minute walking")
            }
            return String(format: String(localized: "Approximately %lld minutes walking"), minutes)
        }
        return model.formattedDistance(for: scooter) ?? String(localized: "Distance unavailable")
    }

    private var providerName: String {
        scooter.providerInfo?.name ?? scooter.provider.capitalized
    }

    private var providerColor: Color {
        if scooter.providerInfo == .bird, colorScheme == .dark {
            return Color(uiColor: .label)
        }
        return scooter.providerInfo?.color ?? .blue
    }

    private var providerActionForeground: Color {
        switch scooter.providerInfo {
        case .bird, .publibike:
            return .white
        case .bolt, .dott, .hopp, .lime, .voi:
            return .black
        case nil:
            return .white
        }
    }

    private var providerActionTint: Color {
        if scooter.providerInfo == .bird, colorScheme == .dark {
            return Color(uiColor: .systemGray2)
        }
        return providerColor
    }
}

struct NearbyScooterListSheet: View {
    @Bindable var model: ScooterMapModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            Group {
                if model.activeOrigin == nil {
                    ContentUnavailableView(
                        "Choose an origin",
                        systemImage: "location.magnifyingglass",
                        description: Text("Search for a place or use your current location from the map.")
                    )
                } else if model.isLoading && model.lastUpdated == nil {
                    ContentUnavailableView {
                        Label("Finding nearby scooters…", systemImage: "location.magnifyingglass")
                    } description: {
                        Text("Live availability will appear here.")
                    } actions: {
                        ProgressView()
                    }
                } else if let errorMessage = model.errorMessage, model.lastUpdated == nil {
                    ContentUnavailableView {
                        Label("Couldn’t load scooters", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Try again", action: model.refresh)
                            .buttonStyle(.glassProminent)
                    }
                } else if model.isShowingClusterSummary {
                    ContentUnavailableView(
                        "Zoom in for nearby details",
                        systemImage: "square.grid.3x3.fill",
                        description: Text("Scooters are grouped at this scale.")
                    )
                } else if model.nearbyScooters.isEmpty {
                    ContentUnavailableView(
                        "No scooters nearby",
                        systemImage: "mappin.slash",
                        description: Text(model.hasActiveFilters
                            ? "Try resetting filters or exploring another area."
                            : "Explore another part of the map.")
                    )
                } else {
                    List {
                        Section {
                            nearbySummary
                                .listRowBackground(Color.clear)
                                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 10, trailing: 0))
                        }

                        Section("Closest first") {
                            ForEach(model.nearbyScooters.prefix(40)) { scooter in
                                NearbyScooterRow(model: model, scooter: scooter) {
                                    model.focusOnScooter(scooter)
                                    dismiss()
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Nearby now")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var nearbySummary: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    summaryMetrics
                    FreshnessLabel(
                        isLoading: model.isLoading,
                        lastUpdated: model.lastUpdated,
                        dataHealthMessage: model.dataHealthMessage
                    )
                }
            } else {
                HStack(spacing: 12) {
                    summaryMetrics
                    Spacer(minLength: 0)
                    FreshnessLabel(
                        isLoading: model.isLoading,
                        lastUpdated: model.lastUpdated,
                        dataHealthMessage: model.dataHealthMessage
                    )
                }
            }
        }
        .padding(.horizontal, 18)
    }

    private var summaryMetrics: some View {
        HStack(spacing: 12) {
            summaryMetric(value: "\(withinThreeMinutes)", label: "within 3 min")
            Divider().frame(height: 34)
            summaryMetric(value: "\(highBatteryCount)", label: "above 70%")
        }
    }

    private func summaryMetric(value: String, label: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.title3.bold())
                .monospacedDigit()
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var withinThreeMinutes: Int {
        model.nearbyScooters.filter {
            (model.approximateWalkingMinutes(to: $0) ?? .max) <= 3
        }.count
    }

    private var highBatteryCount: Int {
        model.nearbyScooters.filter { ($0.battery ?? 0) >= 70 }.count
    }
}

private struct NearbyScooterRow: View {
    @Bindable var model: ScooterMapModel
    let scooter: Scooter
    let action: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: action) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    accessibilityRow
                } else {
                    regularRow
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(String(localized: "Centers this scooter on the map"))
        .accessibilityActions {
            Button("Walk") {
                openWalkingDirections(to: scooter)
            }
            if scooter.rentalURL != nil {
                Button(openProviderLabel) {
                    openProvider()
                }
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if scooter.rentalURL != nil {
                Button(action: openProvider) {
                    Label("Rent", systemImage: "scooter")
                }
                .tint(providerActionAccent)
            }

            Button {
                openWalkingDirections(to: scooter)
            } label: {
                Label("Walk", systemImage: "figure.walk")
            }
            .tint(.blue)
        }
    }

    private var regularRow: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                if let minutes = model.approximateWalkingMinutes(to: scooter) {
                    Text("≈\(minutes)")
                        .font(.title2.bold())
                        .monospacedDigit()
                    Text("min walk")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 62, alignment: .leading)

            providerStripe

            VStack(alignment: .leading, spacing: 4) {
                Text(providerName)
                    .font(.headline)
                vehicleMetrics
            }

            Spacer(minLength: 4)
            rowAccessory
        }
    }

    private var accessibilityRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                providerStripe
                    .frame(height: 40)
                Text(providerName)
                    .font(.headline)
                    .lineLimit(2)
                Spacer(minLength: 4)
                rowAccessory
            }

            if let minutes = model.approximateWalkingMinutes(to: scooter) {
                Text(conciseWalkingSummary(minutes: minutes))
                    .font(.subheadline.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(2)
            }

            vehicleMetrics
        }
        .padding(.vertical, 4)
    }

    private var providerStripe: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(providerAccent)
            .frame(width: 4, height: 42)
            .accessibilityHidden(true)
    }

    private var vehicleMetrics: some View {
        HStack(spacing: 9) {
            if let battery = scooter.battery {
                Label("\(battery)%", systemImage: batterySymbol(for: battery))
                    .foregroundStyle(batteryColor(for: battery))
            }
            if let range = scooter.formattedRange {
                Label(range, systemImage: "gauge.with.dots.needle.67percent")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var rowAccessory: some View {
        if model.selectedScooterID == scooter.id {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.blue)
                .accessibilityLabel(String(localized: "Selected"))
        } else {
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
    }

    private var providerName: String {
        scooter.providerInfo?.name ?? scooter.provider.capitalized
    }

    private var providerAccent: Color {
        if scooter.providerInfo == .bird, colorScheme == .dark {
            return Color(uiColor: .label)
        }
        return scooter.providerInfo?.color ?? .secondary
    }

    private var providerActionAccent: Color {
        if scooter.providerInfo == .bird, colorScheme == .dark {
            return Color(uiColor: .systemGray2)
        }
        return scooter.providerInfo?.color ?? .secondary
    }

    private var openProviderLabel: String {
        String(format: String(localized: "Open %@"), providerName)
    }

    private func openProvider() {
        guard let rentalURL = scooter.rentalURL else { return }
        UIApplication.shared.open(rentalURL)
    }
}

struct ScooterFilterSheet: View {
    @Bindable var model: ScooterMapModel
    @State private var batteryDraft: Double
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    init(model: ScooterMapModel) {
        self.model = model
        _batteryDraft = State(initialValue: model.minimumBattery)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    providerFilters
                    batteryFilters

                    if model.hasActiveFilters {
                        Button("Reset all filters", role: .destructive) {
                            model.resetFilters()
                            batteryDraft = 0
                        }
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .padding(20)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onChange(of: model.minimumBattery) { _, newValue in
                batteryDraft = newValue
            }
            .sensoryFeedback(.selection, trigger: model.enabledProviders)
        }
    }

    private var providerFilters: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Providers", systemImage: "scooter")
                    .font(.headline)
                Spacer()
                Button("Show all", action: model.showAllProviders)
                    .font(.subheadline.weight(.semibold))
                    .disabled(model.allProvidersSelected)
            }

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(ScooterProvider.allCases) { provider in
                    providerButton(provider)
                }
            }
        }
    }

    private func providerButton(_ provider: ScooterProvider) -> some View {
        let selected = model.enabledProviders.contains(provider)
        let accent = providerAccent(provider)
        let count = model.count(for: provider)
        return Button {
            model.toggle(provider: provider)
        } label: {
            HStack(spacing: 9) {
                Circle()
                    .fill(accent)
                    .frame(width: 11, height: 11)
                VStack(alignment: .leading, spacing: 1) {
                    Text(provider.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    Text(count, format: .number)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Spacer(minLength: 0)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? accent : Color.secondary.opacity(0.55))
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(
                selected ? accent.opacity(0.08) : Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(selected ? accent.opacity(0.3) : .clear, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(providerAccessibilityLabel(provider, count: count))
        .accessibilityValue(selected ? String(localized: "Shown") : String(localized: "Hidden"))
    }

    private var batteryFilters: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Minimum battery", systemImage: "battery.50percent")
                .font(.headline)

            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: 8) {
                        batteryPresets
                    }
                } else {
                    HStack(spacing: 8) {
                        batteryPresets
                    }
                }
            }

            VStack(spacing: 8) {
                HStack {
                    Text("Fine tune")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    Text(batteryDraft == 0 ? String(localized: "Any") : "\(Int(batteryDraft))%+")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }

                Slider(value: $batteryDraft, in: 0 ... 100, step: 5) { editing in
                    if !editing {
                        model.setMinimumBattery(batteryDraft)
                    }
                }
                .sensoryFeedback(.selection, trigger: Int(batteryDraft / 5))
                .accessibilityLabel(String(localized: "Minimum battery"))
                .accessibilityValue(
                    batteryDraft == 0
                        ? String(localized: "Any")
                        : String(
                            format: String(localized: "%lld percent or more"),
                            Int64(batteryDraft)
                        )
                )
            }
            .padding(14)
            .background(
                Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )

            if batteryDraft > 0 {
                Text("Scooters without battery data are hidden.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func batteryPreset(title: LocalizedStringKey, value: Double) -> some View {
        let selected = model.minimumBattery == value
        return Button {
            batteryDraft = value
            model.setMinimumBattery(value)
        } label: {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    selected ? Color.blue : Color(uiColor: .secondarySystemGroupedBackground),
                    in: Capsule()
                )
                .foregroundStyle(selected ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityValue(
            selected ? String(localized: "Selected") : String(localized: "Not selected")
        )
    }

    @ViewBuilder
    private var batteryPresets: some View {
        batteryPreset(title: "Any", value: 0)
        batteryPreset(title: "30%+", value: 30)
        batteryPreset(title: "60%+", value: 60)
    }

    private var columns: [GridItem] {
        if dynamicTypeSize.isAccessibilitySize {
            return [GridItem(.flexible(), spacing: 10)]
        }
        return [
            GridItem(.flexible(), spacing: 10),
            GridItem(.flexible(), spacing: 10)
        ]
    }

    private func providerAccent(_ provider: ScooterProvider) -> Color {
        if provider == .bird, colorScheme == .dark {
            return Color(uiColor: .label)
        }
        return provider.color
    }

    private func providerAccessibilityLabel(_ provider: ScooterProvider, count: Int) -> String {
        if count == 1 {
            return String(format: String(localized: "%@, one scooter"), provider.name)
        }
        return String(
            format: String(localized: "%@, %lld scooters"),
            provider.name,
            Int64(count)
        )
    }
}

struct ScooterSettingsSheet: View {
    @Bindable var model: ScooterMapModel
    let onUseCurrentLocation: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Map") {
                    Picker("Appearance", selection: $model.mapStyle) {
                        ForEach(AppleMapStyle.allCases) { style in
                            Text(style.label).tag(style)
                        }
                    }
                    .pickerStyle(.segmented)

                    Button {
                        onUseCurrentLocation()
                        dismiss()
                    } label: {
                        Label("Use current location", systemImage: "location.fill")
                    }

                    Button(action: model.refresh) {
                        HStack {
                            Label("Refresh availability", systemImage: "arrow.clockwise")
                            Spacer()
                            if model.isLoading {
                                ProgressView()
                                    .controlSize(.small)
                            }
                        }
                    }
                    .disabled(model.isLoading)
                }

                Section("Live data") {
                    HStack {
                        Label("Status", systemImage: "dot.radiowaves.left.and.right")
                        Spacer()
                        FreshnessLabel(
                            isLoading: model.isLoading,
                            lastUpdated: model.lastUpdated,
                            dataHealthMessage: model.dataHealthMessage
                        )
                    }

                    if let health = model.dataHealthMessage {
                        Label(health, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    Link(destination: URL(string: "https://opentransportdata.swiss/en/cookbook/shared-mobility/")!) {
                        Label("Mobility data sources", systemImage: "network")
                    }
                    Link(destination: URL(string: "https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api")!) {
                        Label("Address data © swisstopo", systemImage: "map")
                    }
                    Link(destination: URL(string: "https://swiss-scooters.plhery.com/privacy")!) {
                        Label("Privacy", systemImage: "hand.raised")
                    }
                } header: {
                    Text("About")
                } footer: {
                    Text("Availability is refreshed automatically. Opening a provider app does not reserve a scooter.")
                }
            }
            .navigationTitle("More")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

struct FloatingMapControls: View {
    @Bindable var model: ScooterMapModel
    let onLocationIntent: () -> Void

    var body: some View {
        Button {
            onLocationIntent()
            model.focusOnUser()
        } label: {
            ZStack {
                Image(systemName: "location.fill")
                    .opacity(model.isLocating ? 0 : 1)
                if model.isLocating {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .font(.system(size: 18, weight: .semibold))
            .frame(width: 50, height: 50)
        }
        .buttonStyle(.glass)
        .disabled(model.isLocating)
        .accessibilityLabel(String(localized: "Go to my location"))
    }
}

private struct FreshnessLabel: View {
    let isLoading: Bool
    let lastUpdated: Date?
    let dataHealthMessage: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            HStack(spacing: 5) {
                if isLoading {
                    ProgressView()
                        .controlSize(.mini)
                } else if isLive(at: context.date) && dataHealthMessage == nil {
                    LiveIndicator()
                }

                Text(label(at: context.date))
                    .font(.caption)
                    .foregroundStyle(dataHealthMessage == nil ? Color.secondary : Color.orange)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
            }
        }
    }

    private func label(at date: Date) -> String {
        if isLoading { return String(localized: "Updating…") }
        if let dataHealthMessage { return dataHealthMessage }
        guard let lastUpdated else { return String(localized: "Waiting for live data") }
        let age = max(0, date.timeIntervalSince(lastUpdated))
        if age < 90 { return String(localized: "Live") }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(fromTimeInterval: -age)
    }

    private func isLive(at date: Date) -> Bool {
        guard let lastUpdated else { return false }
        return max(0, date.timeIntervalSince(lastUpdated)) < 90
    }

}

private struct LiveIndicator: View {
    @State private var isPulsing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .stroke(.green.opacity(reduceMotion ? 0.18 : (isPulsing ? 0 : 0.32)), lineWidth: 2)
                .scaleEffect(reduceMotion ? 1.35 : (isPulsing ? 1.75 : 0.8))
            Circle()
                .fill(.green)
        }
        .frame(width: 7, height: 7)
        .accessibilityHidden(true)
        .task {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) {
                isPulsing = true
            }
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 9) {
                        statusIndicator
                        statusMessage
                    }

                    if let actionTitle, let action {
                        Button(actionTitle, action: action)
                            .font(.caption.weight(.bold))
                            .buttonStyle(.borderedProminent)
                            .tint(style == .error ? .red : .blue)
                            .frame(maxWidth: .infinity)
                    }
                }
            } else {
                HStack(spacing: 9) {
                    statusIndicator
                    statusMessage
                    statusAction
                }
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, action == nil || dynamicTypeSize.isAccessibilitySize ? 14 : 5)
        .padding(.vertical, action == nil || dynamicTypeSize.isAccessibilitySize ? 10 : 5)
        .glassEffect(
            .regular,
            in: RoundedRectangle(
                cornerRadius: dynamicTypeSize.isAccessibilitySize ? 22 : 999,
                style: .continuous
            )
        )
        .shadow(color: .black.opacity(0.07), radius: 9, y: 4)
        .task(id: announcementSignature) {
            guard UIAccessibility.isVoiceOverRunning else { return }
            UIAccessibility.post(notification: .announcement, argument: message)
        }
    }

    private var announcementSignature: String {
        "\(style)|\(message)"
    }

    @ViewBuilder
    private var statusIndicator: some View {
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
    }

    private var statusMessage: some View {
        Text(message)
            .font(.caption.weight(.semibold))
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 5 : 3)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var statusAction: some View {
        if let actionTitle, let action {
            Button(actionTitle, action: action)
                .font(.caption.weight(.bold))
                .buttonStyle(.borderedProminent)
                .tint(style == .error ? .red : .blue)
        }
    }
}

private func openWalkingDirections(to scooter: Scooter) {
    let location = CLLocation(latitude: scooter.latitude, longitude: scooter.longitude)
    let destination = MKMapItem(location: location, address: nil)
    let providerName = scooter.providerInfo?.name ?? scooter.provider.capitalized
    destination.name = String(
        format: String(localized: "%@ scooter"),
        providerName
    )
    destination.openInMaps(launchOptions: [
        MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
    ])
}

private func conciseWalkingSummary(minutes: Int) -> String {
    String(
        format: String(localized: "≈%lld min walk"),
        Int64(minutes)
    )
}

private func awaySummary(distance: String) -> String {
    String(
        format: String(localized: "%@ away"),
        distance
    )
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
