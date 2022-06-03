// Models
const { Cart } = require('../models/cart.model');
const { ProductsInCart } = require('../models/productsInCart.model');
const { Product } = require('../models/product.model');
const { Order } = require('../models/order.model');

// Utils
const { catchAsync } = require('../utils/catchAsync');
const { AppError } = require('../utils/appError');

const getUserCart = catchAsync(async (req, res, next) => {
  const { sessionUser } = req;

  const cart = await Cart.findOne({
    where: { userId: sessionUser.id, status: 'active' },
    attributes: ['id', 'userId', 'status'],
    include: [
      {
        model: ProductsInCart,
        attributes: ['id', 'productId', 'quantity', 'status'],
        include: [
          {
            model: Product,
            attributes: ['id', 'title', 'description', 'price'],
          },
        ],
      },
    ],
  });

  res.status(200).json({ status: 'success', cart });
});

const addProductToCart = catchAsync(async (req, res, next) => {
  const { productId, quantity } = req.body;
  const { sessionUser } = req;

  const product = await Product.findOne({ where: { id: productId } });

  if (!product) {
    return next(new AppError('There is no product with that ID', 404));
  } else if (quantity > product.quantity) {
    return next(
      new AppError(
        `This product only has ${product.quantity} items available.`,
        400
      )
    );
  }

  const cart = await Cart.findOne({
    where: { userId: sessionUser.id, status: 'active' },
  });

  if (!cart) {
    const newCart = await Cart.create({ userId: sessionUser.id });

    await ProductsInCart.create({ cartId: newCart.id, productId, quantity });
    await Product.update(
      { quantity: product.quantity - quantity },
      { where: { id: productId } }
    );
  } else {
    const productInCart = await ProductsInCart.findOne({
      where: { cartId: cart.id, productId, status: 'active' },
      include: [{ model: Product, attributes: ['id', 'title', 'price'] }],
    });

    if (productInCart && productInCart.status === 'removed') {
      await ProductsInCart.update(
        { quantity: quantity, status: 'active' },
        { where: { id: productInCart.id } }
      );
    } else if (productInCart) {
      return next(
        new AppError(
          `You already have ${productInCart.quantity} ${productInCart.product.title} in your cart. If you want to add more, please change the quantity in "Update Product".`,
          400
        )
      );
    }

    await ProductsInCart.create({ cartId: cart.id, productId, quantity });
  }

  res.status(200).json({
    status: 'Product successfully added to cart.',
  });
});

const updateProductInCart = catchAsync(async (req, res, next) => {
  const { productId, newQty } = req.body;
  const { sessionUser } = req;

  const cart = await Cart.findOne({
    where: { userId: sessionUser.id, status: 'active' },
  });

  if (!cart) {
    return next(
      new AppError(
        'There is no active cart for this user. Please, create it.',
        404
      )
    );
  }

  const product = await Product.findOne({ where: { id: productId } });

  if (!product) {
    return next(new AppError('There is no product with that ID.', 404));
  } else if (newQty > product.quantity) {
    return next(
      new AppError(
        `This product only has ${product.quantity} items available.`,
        400
      )
    );
  }

  const productInCart = await ProductsInCart.findOne({
    where: { cartId: cart.id, productId, status: 'active' },
    include: [
      {
        model: Product,
        attributes: ['id', 'title', 'description', 'price', 'status'],
      },
    ],
  });

  if (!productInCart) {
    return next(new AppError("You don't have that product in your cart", 400));
  }

  if (newQty < 0) {
    return next(new AppError("You can't set a negative quantity", 400));
  }

  if (newQty === 0) {
    await productInCart.update(
      { status: 'removed', quantity: 0 },
      { where: { id: productInCart.id } }
    );
  } else if (newQty > 0) {
 
    await productInCart.update(
      { quantity: newQty, status: 'active' },
      { where: { id: productInCart.id } }
    );
  }

  res.status(200).json({
    status: 'Product quantity successfully updated',
  });
});

const deleteProductFromCart = catchAsync(async (req, res, next) => {
  const { productId } = req.params;
  const { sessionUser } = req;

  const cart = await Cart.findOne({
    where: { userId: sessionUser.id, status: 'active' },
  });

  if (!cart) {
    return next(
      new AppError(
        'There is no active cart for this user. Please, create it.',
        404
      )
    );
  }

  const productInCart = await ProductsInCart.findOne({
    where: { cartId: cart.id, productId, status: 'active' },
  });

  if (!productInCart) {
    return next(new AppError("You don't have that product in your cart", 400));
  }

  await productInCart.update(
    { status: 'removed', quantity: 0 },
    { where: { id: productInCart.id } }
  );

  res.status(200).json({
    status: 'Product successfully deleted from cart.',
  });
});

const purchaseCart = catchAsync(async (req, res, next) => {
  const { sessionUser } = req;

  const cart = await Cart.findOne({
    where: { userId: sessionUser.id, status: 'active' },
    include: [{ model: ProductsInCart, include: [{ model: Product }] }],
  });
  if (!cart) {
    return next(
      new AppError(
        'There is no active cart for this user. Please, create it.',
        404
      )
    );
  }

  const productsInCart = await ProductsInCart.findAll({
    where: { cartId: cart.id, status: 'active' },
    attributes: ['id', 'productId', 'quantity'],
    include: [{ model: Product, attributes: ['id', 'title', 'price'] }],
  });

  productsInCart.forEach(async individualProduct => {

    const updatedProduct = await Product.findOne({
      where: { id: individualProduct.productId },
    });

    const newQuantity = +updatedProduct.quantity - +individualProduct.quantity;

    await Product.update(
      { quantity: newQuantity },
      { where: { id: updatedProduct.id } }
    );
  });

  let totalPrice = 0;
  productsInCart.forEach(individualProduct => {

    totalPrice += individualProduct.product.price * individualProduct.quantity;

    individualProduct.update({ status: 'purchased' });
  });

  await Cart.update(
    {
      status: 'purchased',
    },
    { where: { id: cart.id } }
  );

  await Order.create({
    userId: sessionUser.id,
    cartId: cart.id,
    totalPrice,
    status: 'purshased',
  });

  res.status(200).json({
    status: 'Cart successfully purchased and orders updated',
  });
});

module.exports = {
  getUserCart,
  addProductToCart,
  updateProductInCart,
  deleteProductFromCart,
  purchaseCart,
};
