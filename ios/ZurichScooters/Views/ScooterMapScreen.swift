import SwiftUI

struct ScooterMapScreen: View {
    @State private var model = ScooterMapModel()
    @State private var controlsExpanded = false
    @State private var collapsedDockHeight: CGFloat = 145
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                ScooterMapView(
                    scooters: model.mapScooters,
                    mapStyle: model.mapStyle,
                    focusRequest: model.focusRequest,
                    selectedScooterID: model.selectedScooterID,
                    onRegionChange: model.updateViewport,
                    onSelectionChange: handleSelection
                )
                .ignoresSafeArea()

                statusOverlay(safeAreaTop: proxy.safeAreaInsets.top)

                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        FloatingMapControls(model: model)
                    }
                    .padding(.trailing, 12)
                    .padding(
                        .bottom,
                        collapsedDockHeight + max(proxy.safeAreaInsets.bottom, 8) + 8
                    )
                }
                .opacity(controlsExpanded ? 0 : 1)
                .scaleEffect(controlsExpanded ? 0.92 : 1, anchor: .bottomTrailing)
                .allowsHitTesting(!controlsExpanded)
                .animation(.snappy(duration: 0.3), value: controlsExpanded)

                ScooterControlDock(
                    model: model,
                    isExpanded: $controlsExpanded,
                    onCollapsedHeightChange: { collapsedDockHeight = $0 }
                )
                    .padding(.horizontal, 10)
                    .padding(.bottom, max(proxy.safeAreaInsets.bottom, 8))
            }
        }
        .background(Color(.systemBackground))
        .task { model.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.becameActive()
            }
        }
    }

    @ViewBuilder
    private func statusOverlay(safeAreaTop: CGFloat) -> some View {
        VStack {
            if let errorMessage = model.errorMessage {
                MapStatusBanner(
                    message: errorMessage,
                    isError: true,
                    retry: model.refresh
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            } else if model.isLocating {
                MapStatusBanner(
                    message: "Finding your location…",
                    isError: false,
                    retry: nil
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer()
        }
        .padding(.top, max(safeAreaTop + 6, 12))
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .animation(.snappy(duration: 0.3), value: model.errorMessage)
        .animation(.snappy(duration: 0.3), value: model.isLocating)
    }

    private func handleSelection(_ id: String?) {
        model.selectScooter(id)
        if id != nil {
            withAnimation(.snappy(duration: 0.4, extraBounce: 0.06)) {
                controlsExpanded = true
            }
        }
    }
}

#if DEBUG
private struct ScooterMapScreenPreview: PreviewProvider {
    static var previews: some View {
        ScooterMapScreen()
    }
}
#endif
