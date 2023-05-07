import { OverrideData, ProductInfo } from "../util.js";

const addModal = document.getElementById("adddialog") as HTMLDialogElement;

let authCode = "";
let products: ProductInfo[] = [];

async function login() {
    const password = (document.getElementById("password") as HTMLInputElement).value;
    const totp = (document.getElementById("totp") as HTMLInputElement).value;

    const login = await fetch(`${location.origin}/admin/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            password,
            totp
        })
    });

    if (login.status !== 200) {
        return alert("Invalid login");
    }

    authCode = await login.text();

    products = await
        fetch(`${location.origin}/admin/products`, {
            headers: {
                "Authorization": authCode,
            }
        })
            .then((r) => r.json()) as ProductInfo[];

    renderProducts();
    document.getElementById("loginform").remove();
}

function renderProducts() {
    document.getElementById("stock").innerHTML = "";
    document.getElementById("general").innerHTML = "";

    for (const product of products) {
        const productDiv = document.createElement("div");
        productDiv.classList.add("product");
        productDiv.innerHTML = `
            <h2>${product.long_name} (${product.short_name}) [${product.id}]</h2>
            <p class="desc">${product.description}</p>
            <p>Price: ${product.price}</p>
            <p>Quality: ${product.quality}</p>
            <p>Images: ${product.images.join(", ")}</p>
            <p>Override: ${product.overrides ? JSON.stringify(product.overrides) : "None"}</p>
        `;

        const deleteButton = document.createElement("img");
        deleteButton.src = "trash.svg";
        deleteButton.classList.add("delete");
        deleteButton.width = deleteButton.height = 20;
        deleteButton.addEventListener("click", async () => {
            const confirm = window.confirm("Are you sure you want to delete this product?");
            if (!confirm) return;

            products.splice(products.findIndex(p => p.id === product.id), 1);
            updateProducts();
            renderProducts();
        });

        productDiv.appendChild(deleteButton);
        document.getElementById(product.stock ? "stock" : "general").appendChild(productDiv);
    }
}

function updateProducts() {
    fetch(`${location.origin}/admin/products`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": authCode
        },
        body: JSON.stringify(products)
    });
}

document.getElementById("addoverride").addEventListener("click", (e) => {
    e.preventDefault();

    const overrides = document.getElementById("overrides") as HTMLDivElement;

    const override = document.createElement("form");
    override.classList.add("override-form");

    const overrideType = document.createElement("select");
    overrideType.innerHTML = `
        <option value="color">Color</option>
        <option value="storage">Storage</option>
    `;
    overrideType.addEventListener("change", (e) => {
        reloadOverride(overrideType.value as "color" | "storage");
    });

    const reloadOverride = (type: "color" | "storage") => {
        override.innerHTML = "";

        override.appendChild(overrideType);

        if (type === "color") {
            const name = document.createElement("input");
            name.type = "text";
            name.placeholder = "Name";
            // pattern is lower case letters only
            name.pattern = "^[a-z]+$";
            name.required = true;

            const color = document.createElement("input");
            color.type = "color";
            color.value = "#000000";
            color.pattern = "^#[0-9a-fA-F]{6}$";
            color.required = true;

            const readable = document.createElement("input");
            readable.type = "text";
            readable.placeholder = "Name";
            // pattern is letters only
            readable.pattern = "^[a-zA-Z]+$";
            readable.required = true;

            override.append(name, color, readable);
        }

        if (type === "storage") {
            const size = document.createElement("input");
            size.type = "number";
            size.placeholder = "Size (in GB)";
            size.required = true;

            const name = document.createElement("input");
            name.type = "text";
            name.placeholder = "Name (e.g., 128 GB)";
            name.required = true;

            const price = document.createElement("input");
            price.type = "number";
            price.placeholder = "Price (in USD)";
            price.step = "0.01";

            const colorcomp = document.createElement("input");
            colorcomp.type = "string";
            colorcomp.placeholder = "Compatible colors (seperate with comma)";

            override.append(size, name, price, colorcomp);
        }

        const close = document.createElement("button");
        close.innerText = "Remove";
        close.addEventListener("click", (e) => {
            e.preventDefault();
            override.remove();
        });

        override.append(close);
    };

    reloadOverride(overrideType.value as "color" | "storage");

    overrides.appendChild(override);
});

function collectOverride(): OverrideData {
    // go through every override form and collect the data
    const overrides = document.getElementsByClassName("override-form");

    const overrideData: OverrideData = { color: [], storage: [] };

    for (let i = 0; i < overrides.length; i++) {
        const override = overrides.item(i) as HTMLFormElement;
        const type = (override.children[0] as HTMLInputElement).value as "color" | "storage";

        if (type === "color") {
            const name = (override.children[1] as HTMLInputElement).value;
            const color = (override.children[2] as HTMLInputElement).value;
            const readable = (override.children[3] as HTMLInputElement).value;

            overrideData.color.push({ name, color, readable });
        }

        if (type === "storage") {
            const size = (override.children[1] as HTMLInputElement).valueAsNumber;
            const name = (override.children[2] as HTMLInputElement).value;
            const price = (override.children[3] as HTMLInputElement).valueAsNumber;
            let colorcomp = (override.children[4] as HTMLInputElement).value.split(",").map(l => l.trim());
            if (colorcomp.length === 0 || colorcomp[0] === "") colorcomp = undefined;

            overrideData.storage.push({ size, name, price: price == null ? undefined : price, colorcomp });
        }
    }

    return overrideData;
}

document.getElementById("loginform").addEventListener("submit", (e) => {
    e.preventDefault();

    login();
});

document.getElementById("addform").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!authCode) return;

    const overrides = collectOverride();
    // check if both color or storage are empty
    if (overrides.color.length === 0 || overrides.storage.length === 0) return alert("You must have at least one override for each type");

    const product: ProductInfo = {
        id: (document.getElementById("id") as HTMLInputElement).value,
        long_name: (document.getElementById("name") as HTMLInputElement).value,
        short_name: (document.getElementById("shortname") as HTMLInputElement).value,
        description: (document.getElementById("description") as HTMLInputElement).value,
        price: (document.getElementById("price") as HTMLInputElement).valueAsNumber,
        quality: (document.getElementById("quality") as HTMLInputElement).value,
        images: (document.getElementById("images") as HTMLInputElement).value.split(",").map(l => l.trim()),
        stock: (document.getElementById("category") as HTMLSelectElement).value === "stock",
        overrides
    }

    if (products.find((p) => p.id === product.id)) return alert("Product already exists");

    products.push(product);
    updateProducts();
    renderProducts();
});

document.getElementById("add").addEventListener("click", () => {
    addModal.showModal();
});

document.getElementById("cancel").addEventListener("click", () => {
    addModal.close();
})