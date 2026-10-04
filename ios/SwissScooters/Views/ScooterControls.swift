import Foundation
import MapKit
import SwiftUI
import UIKit

/// Colours for small text and filled controls. The system tints are too light
/// for that on glass; these keep a contrast of at least 4.5:1.
enum ScooterPalette {
    /// The app's blue under white text.
    static let actionFill = Color(red: 0, green: 0.42, blue: 0.9)
    /// Blue text on glass or on a blue tint.
    static let actionText = adaptive(
        light: UIColor(red: 0, green: 0.38, blue: 0.8, alpha: 1),
        dark: UIColor(red: 0.36, green: 0.69, blue: 1, alpha: 1)
    )
    static let warning = adaptive(
        light: UIColor(red: 0.54, green: 0.3, blue: 0, alpha: 1),
        dark: .systemOrange
    )
    static let good = adaptive(
        light: UIColor(red: 0.11, green: 0.47, blue: 0.2, alpha: 1),
        dark: .systemGreen
    )
    static let critical = adaptive(
        light: UIColor(red: 0.7, green: 0.15, blue: 0.12, alpha: 1),
        dark: .systemRed
    )

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

struct ScooterControlDock: View {
    @Bindable var model: ScooterMapModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let maximumContentHeight: CGFloat
    private let onEditFilters: () -> Void
    private let onHeightChange: (CGFloat) -> Void

    init(
        model: ScooterMapModel,
        maximumContentHeight: CGFloat = .infinity,
        onEditFilters: @escaping () -> Void = {},
        onHeightChange: @escaping (CGFloat) -> Void = { _ in }
    ) {
        self.model = model
        self.maximumContentHeight = maximumContentHeight
        self.onEditFilters = onEditFilters
        self.onHeightChange = onHeightChange
    }

    var body: some View {
        let content = model.dock

        // Content taller than the room above the dock scrolls, as with large text.
        DockHeightLimit(maximum: maximumContentHeight) {
            ViewThatFits(in: .vertical) {
                dockContent(content)
                ScrollView(.vertical) {
                    dockContent(content)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: 560)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 12, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { height in
            onHeightChange(height)
        }
        .animation(
            reduceMotion ? nil : .snappy(duration: 0.28, extraBounce: 0.06),
            value: content.kind
        )
        .sensoryFeedback(.selection, trigger: model.enabledProviders)
    }

    @ViewBuilder
    private func dockContent(_ content: ScooterDockContent) -> some View {
        switch content {
        case let .scooter(scooter):
            ScooterCard(model: model, scooter: scooter)
        case let .parking(parking):
            ParkingBayCard(model: model, parking: parking)
        case let .outOfDate(failure, lastUpdate):
            outOfDateCard(failure, lastUpdate: lastUpdate)
        case let .finding(chips):
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityHidden(true)
                    Text("Finding scooters…")
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity, minHeight: Self.headerHeight, alignment: .leading)

                if !chips.isEmpty {
                    providerChips(chips)
                }
            }
        case .waiting:
            Text("Waiting for scooter data")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: Self.headerHeight, alignment: .leading)
        case let .outsideCoverage(cities):
            outsideCoverageCard(cities)
        case let .filtersHideEverything(summary):
            hiddenByFiltersCard(summary)
        case let .summary(summary):
            summaryContent(summary)
        }
    }

    /// Count and status, and "Finding scooters…" in their place, keep one
    /// height so the dock does not jump while the map moves.
    private static let headerHeight: CGFloat = 38

    private func summaryContent(_ summary: ScooterDockSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(summary.count, format: .number)
                            .font(.headline.weight(.bold))
                            .monospacedDigit()
                            .contentTransition(.numericText())
                        Text(summary.countLabel)
                            .font(.subheadline.weight(.semibold))
                    }
                    .accessibilityElement(children: .combine)

                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        DockStatusLabel(status: summary.status(at: context.date))
                    }
                }
                .frame(minHeight: Self.headerHeight, alignment: .leading)

                Spacer(minLength: 8)

                if summary.showsTryAgain {
                    TryAgainPill(isLoading: model.isLoading, action: model.retryLoad)
                        .transition(.opacity)
                }
            }

            if !summary.notices.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(summary.notices) { notice in
                        DockNoteRow(systemImage: "exclamationmark.triangle", text: notice.text)
                    }
                }
            }

            providerChips(summary.chips)

            if let hint = summary.hint {
                DockNoteRow(
                    systemImage: hint == .tapCity ? "mappin.and.ellipse" : "scooter",
                    text: hint.text
                )
            }
        }
    }

    private func providerChips(_ chips: [ScooterProviderEntry]) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                QuickProviderFilterChip(
                    title: String(localized: "All"),
                    accessibilityTitle: String(localized: "All providers"),
                    count: model.allProviderCount,
                    color: nil,
                    isSelected: model.allProvidersSelected,
                    accessibilityIsShown: model.allProvidersSelected,
                    action: model.showAllProviders
                )

                ForEach(chips) { entry in
                    providerChip(entry)
                }
            }
            .animation(
                reduceMotion ? nil : .snappy(duration: 0.25),
                value: chips.map(\.provider)
            )
        }
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, 2, for: .scrollContent)
    }

    private func providerChip(_ entry: ScooterProviderEntry) -> some View {
        QuickProviderFilterChip(
            title: entry.provider.name,
            accessibilityTitle: entry.isDown ? entry.downLabel : entry.provider.name,
            count: entry.count,
            color: entry.provider.color,
            isSelected: entry.isSelected,
            isDown: entry.isDown,
            accessibilityIsShown: entry.isEnabled
        ) {
            model.toggleQuickProvider(entry.provider)
        }
        .accessibilityHint(quickProviderHint(entry.provider))
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

    private func outOfDateCard(_ failure: ScooterLoadFailure, lastUpdate: Date) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DockCardHeader(
                systemImage: "clock",
                tint: ScooterPalette.warning,
                title: String(localized: "These positions are out of date"),
                message: ScooterDockStatus.outOfDateBody(failure, lastUpdate: lastUpdate)
            )

            DockActionRow {
                Button(action: model.retryLoad) {
                    ZStack {
                        Label("Try again", systemImage: "arrow.clockwise")
                            .opacity(model.isLoading ? 0 : 1)
                        if model.isLoading {
                            ProgressView()
                                .tint(.white)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(.white)
                }
                .dockActionStyle(prominent: true)
                .disabled(model.isLoading)
                .accessibilityLabel(String(localized: "Try again"))
            }
        }
    }

    private func outsideCoverageCard(_ cities: [ScooterCityDistance]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DockCardHeader(
                systemImage: "map",
                tint: ScooterPalette.actionText,
                title: String(localized: "No scooter data here yet"),
                message: String(localized: "Scooters covers selected cities in France, Switzerland, Germany and Italy.")
            )

            VStack(alignment: .leading, spacing: 8) {
                Text("Closest cities")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)

                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(cities) { entry in
                        Button {
                            model.focusOnCity(entry.city)
                        } label: {
                            Label(entry.label, systemImage: "mappin.and.ellipse")
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .background(Color.primary.opacity(0.055), in: Capsule())
                                .overlay {
                                    Capsule().stroke(Color.secondary.opacity(0.16), lineWidth: 1)
                                }
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func hiddenByFiltersCard(_ summary: ScooterFilterSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DockCardHeader(
                systemImage: "line.3.horizontal.decrease",
                tint: ScooterPalette.actionText,
                title: summary.title,
                message: summary.body
            )

            DockActionRow {
                Button(action: model.resetFilters) {
                    // "Show all 1" reads badly; one hidden scooter gets the plain label.
                    Text(summary.hiddenCount == 1 ? String(localized: "Show all") : summary.showAllTitle)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                }
                .dockActionStyle(prominent: true)

                Button(action: onEditFilters) {
                    Text("Edit filters")
                        .frame(maxWidth: .infinity)
                }
                .dockActionStyle(prominent: false)
            }
        }
    }
}

private extension ScooterDockContent {
    /// What the dock shows, without its details: a change of kind animates.
    var kind: String {
        switch self {
        case let .scooter(scooter): "scooter:\(scooter.id)"
        case let .parking(parking): "parking:\(parking.id)"
        case .outOfDate: "outOfDate"
        case .finding: "finding"
        case .waiting: "waiting"
        case .outsideCoverage: "outsideCoverage"
        case .filtersHideEverything: "filtersHideEverything"
        case .summary: "summary"
        }
    }
}

/// Gives its content the height it asks for, up to a limit.
private struct DockHeightLimit: Layout {
    let maximum: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        let ideal = content.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
        return CGSize(width: ideal.width, height: min(ideal.height, maximum))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(
            at: bounds.origin,
            proposal: ProposedViewSize(width: bounds.width, height: bounds.height)
        )
    }
}

/// Rows that wrap: pills and chips move to the next line when one is full.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    private struct Row {
        var sizes: [CGSize] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(for: subviews, width: proposal.width)
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var index = subviews.startIndex
        var y = bounds.minY
        for row in rows(for: subviews, width: bounds.width) {
            var x = bounds.minX
            for size in row.sizes {
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
                index = subviews.index(after: index)
            }
            y += row.height + lineSpacing
        }
    }

    private func rows(for subviews: Subviews, width: CGFloat?) -> [Row] {
        let available = width ?? .infinity
        var rows = [Row()]
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            var row = rows[rows.count - 1]
            if !row.sizes.isEmpty, row.width + spacing + size.width > available {
                row = Row()
                rows.append(row)
            }
            row.width += (row.sizes.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.sizes.append(size)
            rows[rows.count - 1] = row
        }
        return rows
    }
}

/// The status line under the count, and at the top of a card while data is failing.
private struct DockStatusLabel: View {
    let status: ScooterDockStatus
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: 5) {
            if status.isLive {
                LiveIndicator()
            } else if status.isWarning {
                Image(systemName: "exclamationmark.triangle")
                    .font(.caption2.weight(.semibold))
                    .accessibilityHidden(true)
            }

            Text(status.text)
                .font(.caption)
                .monospacedDigit()
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(status.isWarning ? ScooterPalette.warning : Color.secondary)
    }
}

/// A calm line in the dock: a small icon and secondary text.
private struct DockNoteRow: View {
    let systemImage: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: systemImage)
                .font(.caption2.weight(.semibold))
                .accessibilityHidden(true)
            Text(text)
                .font(.caption)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.secondary)
        .padding(.leading, 2)
    }
}

private struct TryAgainPill: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text("Try again")
                    .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(ScooterPalette.actionText)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(ScooterPalette.actionText.opacity(0.12), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .accessibilityLabel(String(localized: "Try again"))
    }
}

/// The head of a dock card: a tinted symbol, a title and the sentence under it.
private struct DockCardHeader: View {
    let systemImage: String
    let tint: Color
    let title: String
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DockSymbolTile(systemImage: systemImage, foreground: tint, tint: tint)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                if !message.isEmpty {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct DockSymbolTile: View {
    let systemImage: String
    var foreground: Color = .primary
    let tint: Color
    var size: CGFloat = 44

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.43, weight: .semibold))
            .foregroundStyle(foreground)
            .frame(width: size, height: size)
            .background(
                tint.opacity(0.16),
                in: RoundedRectangle(cornerRadius: size / 3, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

/// One or two buttons side by side; stacked when the text is very large.
private struct DockActionRow<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 9) { content }
            } else {
                HStack(spacing: 9) { content }
            }
        }
        .font(.subheadline.weight(.semibold))
        .controlSize(.large)
    }
}

private extension View {
    /// The filled button in the app's blue, or the quiet glass one beside it.
    @ViewBuilder
    func dockActionStyle(prominent: Bool) -> some View {
        if prominent {
            buttonStyle(.glassProminent)
                .tint(ScooterPalette.actionFill)
        } else {
            buttonStyle(.glass)
        }
    }

    func dockPill(_ foreground: Color = .primary, background: Color = Color(uiColor: .tertiarySystemFill)) -> some View {
        font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(minHeight: 32)
            .background(background, in: Capsule())
    }
}

private struct DockCloseButton: View {
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .background(.quaternary, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// A scooter or bay card hides the dock's status line, so a failed refresh or
/// delayed data is reported here. Nothing shows while the data is healthy.
private struct CardStatusLine: View {
    let model: ScooterMapModel

    var body: some View {
        if let status = model.cardStatus {
            HStack(spacing: 8) {
                DockStatusLabel(status: status)
                Spacer(minLength: 4)
                if status.isWarning {
                    Button(action: model.retryLoad) {
                        Text("Try again")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ScooterPalette.actionText)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isLoading)
                }
            }
            // The button keeps its 44 pt target; the line stays compact.
            .padding(.vertical, status.isWarning ? -8 : 0)
        }
    }
}

private struct QuickProviderFilterChip: View {
    let title: String
    let accessibilityTitle: String
    let count: Int
    /// The provider's colour; nil for "All".
    let color: Color?
    let isSelected: Bool
    /// Not sharing data and none in view: dashed, with a warning instead of a count.
    var isDown = false
    let accessibilityIsShown: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                indicator

                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                if isDown {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ScooterPalette.warning)
                } else {
                    Text(count, format: .number)
                        .font(.caption2.weight(.bold))
                        .monospacedDigit()
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.quaternary, in: Capsule())
                        .contentTransition(.numericText())
                }
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(background, in: Capsule())
            .overlay {
                if isDown {
                    Capsule()
                        .strokeBorder(
                            Color.secondary.opacity(0.6),
                            style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                        )
                } else {
                    Capsule()
                        .stroke(
                            isSelected ? Color.blue.opacity(0.32) : Color.secondary.opacity(0.16),
                            lineWidth: 1
                        )
                }
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

    private var foreground: Color {
        if isDown { return .secondary }
        return isSelected ? ScooterPalette.actionText : .primary
    }

    private var background: Color {
        if isDown { return .clear }
        return isSelected ? Color.blue.opacity(0.13) : Color.primary.opacity(0.055)
    }

    @ViewBuilder
    private var indicator: some View {
        if let color {
            Circle()
                .fill(isDown ? Color.secondary : color)
                .frame(width: 11, height: 11)
                .overlay {
                    Circle().stroke(.background, lineWidth: 1.5)
                }
                .accessibilityHidden(true)
        } else {
            Image(systemName: "circle.grid.2x2.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(isSelected ? ScooterPalette.actionText : Color.secondary)
        }
    }

    private var accessibilityLabel: String {
        if isDown { return accessibilityTitle }
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

private struct ScooterCard: View {
    let model: ScooterMapModel
    let scooter: Scooter
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardStatusLine(model: model)
            header
            pills

            DockActionRow {
                Button {
                    ScooterAnalytics.shared.track("directions_open", provider: scooter.provider, target: "vehicle")
                    openWalkingDirections(to: scooter)
                } label: {
                    Label("Directions", systemImage: "figure.walk")
                        .frame(maxWidth: .infinity)
                }
                .dockActionStyle(prominent: false)

                if let rentalURL = scooter.rentalURL {
                    Button {
                        ScooterAnalytics.shared.track("rental_open", provider: scooter.provider)
                        UIApplication.shared.open(rentalURL)
                    } label: {
                        Label(
                            String(format: String(localized: "Open in %@"), providerName),
                            systemImage: "scooter"
                        )
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                    }
                    .dockActionStyle(prominent: true)
                }
            }

            Text(String(
                format: scooter.rentalURL == nil
                    ? String(localized: "Open the %@ app to rent this scooter.")
                    : String(localized: "Opens the %@ app. It won’t reserve the scooter."),
                providerName
            ))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            if let walk = model.walkingSummary(for: scooter) {
                Button {
                    model.focusOnScooter(scooter)
                } label: {
                    HStack(spacing: 12) {
                        tile
                        titleBlock {
                            Text(walk)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint(String(localized: "Centers this scooter on the map"))
            } else {
                Button {
                    model.focusOnScooter(scooter)
                } label: {
                    tile
                }
                .buttonStyle(.plain)
                .accessibilityLabel(providerName)
                .accessibilityHint(String(localized: "Centers this scooter on the map"))

                if model.isLocating {
                    titleBlock {
                        HStack(spacing: 6) {
                            ProgressView()
                                .controlSize(.mini)
                                .accessibilityHidden(true)
                            Text("Finding your location…")
                        }
                        .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                } else {
                    // Locates without moving the map, so this card stays open.
                    Button(action: model.locateForWalkingTime) {
                        titleBlock {
                            Text("Turn on location to see walking time")
                                .foregroundStyle(ScooterPalette.actionText)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer(minLength: 4)

            DockCloseButton(accessibilityLabel: String(localized: "Close scooter details")) {
                model.selectScooter(nil)
            }
        }
    }

    private var tile: some View {
        DockSymbolTile(systemImage: "scooter", tint: providerTint, size: 48)
    }

    private func titleBlock(@ViewBuilder subtitle: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(providerName)
                .font(.headline)
            subtitle()
                .font(.footnote)
        }
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .frame(minHeight: 44, alignment: .leading)
    }

    private var pills: some View {
        FlowLayout(spacing: 6, lineSpacing: 0) {
            if let battery = scooter.battery, let level = scooter.batteryLevel {
                HStack(spacing: 5) {
                    Image(systemName: batterySymbol(for: battery))
                    Text("\(battery)%")
                }
                .dockPill(level.color, background: level.color.opacity(0.14))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(String(localized: "Battery"))
                .accessibilityValue(String(format: String(localized: "%lld percent"), Int64(battery)))
            }

            if let range = scooter.formattedRange {
                HStack(spacing: 5) {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                    Text(range)
                }
                .dockPill()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(String(localized: "Estimated"))
                .accessibilityValue(range)
            }

            pricePill
        }
        // The price pill's 44 pt target makes the row taller than the pills look.
        .padding(.vertical, -4)
    }

    @ViewBuilder
    private var pricePill: some View {
        if let quote = model.ridePriceQuote(for: scooter) {
            let price = priceLabel(quote)
            Menu {
                ForEach(RideEstimateDuration.allowedMinutes, id: \.self) { minutes in
                    Button {
                        model.setRideEstimateMinutes(minutes)
                    } label: {
                        if minutes == model.rideEstimateMinutes {
                            Label(durationLabel(minutes), systemImage: "checkmark")
                        } else {
                            Text(durationLabel(minutes))
                        }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    if quote.passApplied {
                        Image(systemName: "ticket.fill")
                    }
                    Text(price)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.bold))
                        .opacity(0.6)
                }
                .dockPill(
                    quote.passApplied ? ScooterPalette.good : .primary,
                    background: quote.passApplied
                        ? ScooterPalette.good.opacity(0.14)
                        : Color(uiColor: .tertiarySystemFill)
                )
                // The pill stays small; its target is 44 pt high.
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(
                format: String(localized: "Ride estimate, %lld minutes. Change duration."),
                Int64(model.rideEstimateMinutes)
            ))
            .accessibilityValue(price)
        } else {
            HStack(spacing: 5) {
                Image(systemName: "creditcard")
                    .accessibilityHidden(true)
                Text(String(format: String(localized: "Price shown in the %@ app"), providerName))
            }
            .dockPill()
            .frame(minHeight: 44)
        }
    }

    /// "≈ CHF 4.50 for 10 min", followed by "Pass applied" when a pass lowers it.
    private func priceLabel(_ quote: RidePriceQuote) -> String {
        let estimate = String(
            format: String(localized: "≈ %1$@ for %2$lld min"),
            RidePriceFormatter.string(minorUnits: quote.totalMinorUnits, currency: quote.currency),
            Int64(quote.durationMinutes)
        )
        guard quote.passApplied else { return estimate }
        return String(
            format: String(localized: "%1$@ · %2$@"),
            estimate,
            String(localized: "Pass applied")
        )
    }

    private func durationLabel(_ minutes: Int) -> String {
        String(format: String(localized: "%lld min"), Int64(minutes))
    }

    private var providerName: String {
        scooter.providerInfo?.name ?? scooter.provider.capitalized
    }

    private var providerTint: Color {
        providerAccent(scooter.providerInfo, colorScheme: colorScheme)
    }
}

private struct ParkingBayCard: View {
    let model: ScooterMapModel
    let parking: ScooterParking
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardStatusLine(model: model)

            HStack(spacing: 12) {
                HStack(spacing: 12) {
                    Text(verbatim: "P")
                        .font(.system(size: 23, weight: .heavy, design: .rounded))
                        .frame(width: 48, height: 48)
                        .background(
                            Color(uiColor: .systemBackground),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(
                                    providerAccent(parking.providerInfo, colorScheme: colorScheme),
                                    lineWidth: 3
                                )
                        }
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(parking.bayTitle)
                            .font(.headline)
                        let subtitle = model.parkingSubtitle(for: parking)
                        if !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)

                Spacer(minLength: 4)

                DockCloseButton(accessibilityLabel: String(localized: "Close parking details")) {
                    model.selectParking(nil)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "info.circle")
                    .accessibilityHidden(true)
                Text(parking.notice)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(parking.mandatory ? ScooterPalette.warning : Color.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                parking.mandatory
                    ? ScooterPalette.warning.opacity(0.14)
                    : Color(uiColor: .tertiarySystemFill),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )

            DockActionRow {
                Button {
                    ScooterAnalytics.shared.track("directions_open", provider: parking.provider, target: "parking")
                    openWalkingDirections(to: parking)
                } label: {
                    Label("Directions", systemImage: "figure.walk")
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                }
                .dockActionStyle(prominent: true)
            }

            Text(parking.footnote)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
        }
    }
}

private extension ScooterBatteryLevel {
    var color: Color {
        switch self {
        case .good: ScooterPalette.good
        case .low: ScooterPalette.warning
        case .critical: ScooterPalette.critical
        }
    }
}

/// The provider's colour; Bird's near-black turns to the label colour in dark appearance.
private func providerAccent(_ provider: ScooterProvider?, colorScheme: ColorScheme) -> Color {
    guard let provider else { return .blue }
    if provider == .bird, colorScheme == .dark {
        return Color(uiColor: .label)
    }
    return provider.color
}

private enum RidePriceFormatter {
    static func string(minorUnits: Int, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = .current
        formatter.numberStyle = .currency
        formatter.currencyCode = currency.uppercased()
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2

        let amount = NSDecimalNumber(value: minorUnits)
            .dividing(by: NSDecimalNumber(value: 100))
        return formatter.string(from: amount)
            ?? "\(currency.uppercased()) \(amount.stringValue)"
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
                ForEach(model.availableProviders) { provider in
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
                        // The model keeps to its presets; show what it kept.
                        batteryDraft = model.minimumBattery
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
    @AppStorage(ScooterAnalytics.disabledKey) private var analyticsDisabled = false
    @Bindable var model: ScooterMapModel
    let onUseCurrentLocation: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Analytics") {
                    Toggle("Share anonymous usage", isOn: Binding(
                        get: { !analyticsDisabled }, set: { analyticsDisabled = !$0 }
                    ))
                    Text("Helps improve Scooters. No addresses or precise locations are sent.")
                        .font(.caption).foregroundStyle(.secondary)
                }
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

                    Button {
                        ScooterAnalytics.shared.track("refresh")
                        model.refresh()
                    } label: {
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

                Section {
                    ForEach(ScooterProvider.allCases) { provider in
                        NavigationLink {
                            ProviderRidePassEditor(model: model, provider: provider)
                        } label: {
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(provider.color)
                                    .frame(width: 10, height: 10)
                                Text(provider.name)
                                Spacer(minLength: 8)
                                Text(passStatus(for: provider))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.trailing)
                                    .lineLimit(2)
                            }
                        }
                    }
                } header: {
                    Text("Passes")
                } footer: {
                    Text("Pass benefits are used only for estimates. Free-minute balances are not reduced automatically.")
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
                    Link(destination: URL(string: "https://transport.data.gouv.fr/datasets?type=vehicles-sharing")!) {
                        Label("French mobility data", systemImage: "network")
                    }
                    Link("MobiData BW", destination: URL(string: "https://www.mobidata-bw.de/")!)
                    Link("DE/IT: Dott, Bolt, Hopp, Lime, Voi, Bird", destination: URL(string: "https://github.com/MobilityData/gbfs")!)
                    Link(destination: URL(string: "https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api")!) {
                        Label("Address data © swisstopo", systemImage: "map")
                    }
                    Link(destination: URL(string: "https://scooters.plhery.com/privacy")!) {
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

    private func passStatus(for provider: ScooterProvider) -> String {
        let pass = model.ridePass(for: provider)
        guard pass.enabled else { return String(localized: "Not set") }
        guard pass.isActive(on: .now) else { return String(localized: "Expired") }

        var benefits: [String] = []
        if pass.freeUnlock {
            benefits.append(String(localized: "Free unlock"))
        }
        if pass.freeMinutes > 0 {
            benefits.append(String(
                format: String(localized: "%lld free min"),
                Int64(pass.freeMinutes)
            ))
        }
        return benefits.isEmpty
            ? String(localized: "Pass active")
            : benefits.joined(separator: " · ")
    }
}

private struct ProviderRidePassEditor: View {
    @Bindable var model: ScooterMapModel
    let provider: ScooterProvider

    var body: some View {
        Form {
            Section {
                Toggle("I have a pass", isOn: passBinding(\.enabled))
            } footer: {
                Text("Your pass details stay on this iPhone.")
            }

            if pass.enabled {
                Section("Pass benefits") {
                    Toggle("Free unlock", isOn: passBinding(\.freeUnlock))

                    Stepper(
                        value: passBinding(\.freeMinutes),
                        in: 0 ... 500,
                        step: 5
                    ) {
                        HStack {
                            Text("Free minutes available")
                            Spacer()
                            Text(pass.freeMinutes, format: .number)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                }

                Section {
                    Toggle("Has expiry date", isOn: hasExpiryBinding)

                    if pass.expiryDate != nil {
                        DatePicker(
                            "Valid through",
                            selection: expiryDateBinding,
                            displayedComponents: .date
                        )

                        if !pass.isActive(on: .now) {
                            Label("This pass has expired", systemImage: "exclamationmark.circle.fill")
                                .font(.subheadline)
                                .foregroundStyle(.orange)
                        }
                    }
                } header: {
                    Text("Expiry")
                } footer: {
                    Text("Benefits remain active through the end of the selected day.")
                }
            }

            Section {
                Text("Pricing can vary. Confirm the final price and pass eligibility in the provider app before riding.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(String(format: String(localized: "%@ pass"), provider.name))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var pass: ProviderRidePass {
        model.ridePass(for: provider)
    }

    private func passBinding<Value>(
        _ keyPath: WritableKeyPath<ProviderRidePass, Value>
    ) -> Binding<Value> {
        Binding {
            model.ridePass(for: provider)[keyPath: keyPath]
        } set: { value in
            var updatedPass = model.ridePass(for: provider)
            updatedPass[keyPath: keyPath] = value
            model.setRidePass(updatedPass, for: provider)
        }
    }

    private var hasExpiryBinding: Binding<Bool> {
        Binding {
            model.ridePass(for: provider).expiryDate != nil
        } set: { hasExpiry in
            var updatedPass = model.ridePass(for: provider)
            updatedPass.expiryDate = hasExpiry ? defaultExpiryDate : nil
            model.setRidePass(updatedPass, for: provider)
        }
    }

    private var expiryDateBinding: Binding<Date> {
        Binding {
            model.ridePass(for: provider).expiryDate ?? defaultExpiryDate
        } set: { expiryDate in
            var updatedPass = model.ridePass(for: provider)
            updatedPass.expiryDate = expiryDate
            model.setRidePass(updatedPass, for: provider)
        }
    }

    private var defaultExpiryDate: Date {
        Calendar.current.date(byAdding: .month, value: 1, to: .now) ?? .now
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

private func openWalkingDirections(to parking: ScooterParking) {
    let location = CLLocation(latitude: parking.latitude, longitude: parking.longitude)
    let destination = MKMapItem(location: location, address: nil)
    destination.name = parking.name.isEmpty ? parking.bayTitle : parking.name
    destination.openInMaps(launchOptions: [
        MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
    ])
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
