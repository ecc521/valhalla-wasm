#include <emscripten/bind.h>
#include <valhalla/tyr/actor.h>
#include <valhalla/midgard/logging.h>
#include <iostream>
#include <string>
#include <boost/property_tree/ptree.hpp>
#include <boost/property_tree/json_parser.hpp>
#include <sstream>

using namespace emscripten;

class ValhallaRouter {
private:
    std::shared_ptr<valhalla::tyr::actor_t> actor;

public:
    ValhallaRouter(const std::string& config_json) {
        try {
            // Parse the JSON config string to bootstrap the engine
            boost::property_tree::ptree pt;
            std::stringstream ss(config_json);
            boost::property_tree::read_json(ss, pt);
            
            actor = std::make_shared<valhalla::tyr::actor_t>(pt);
            valhalla::midgard::logging::Configure({{"type", "std_out"}, {"color", "true"}});
            std::cout << "[Valhalla WASM] Engine initialized successfully!" << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "[Valhalla WASM] Failed to initialize engine: " << e.what() << std::endl;
        }
    }

    // Expose the route method to Javascript
    std::string route(const std::string& request_json) {
        if (!actor) return "{\"error\":\"Engine not initialized\"}";
        try {
            return actor->route(request_json);
        } catch (const std::exception& e) {
            return std::string("{\"error\":\"") + e.what() + "\"}";
        }
    }
    
    // Other endpoints can be exposed similarly (e.g. locate, isochrone)
};

// Bind the C++ class to Javascript using Embind
EMSCRIPTEN_BINDINGS(valhalla_module) {
    class_<ValhallaRouter>("ValhallaRouter")
        .constructor<const std::string&>()
        .function("route", &ValhallaRouter::route);
}
